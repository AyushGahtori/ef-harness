import fs from "node:fs";
import {
  AmbiguousEditMatchError,
  EditStuckEscalation,
  EditToolNotOfferedError,
  ElisionPlaceholderError,
  EmptySearchTextError,
  FileAlreadyExistsError,
  FileChangedExternallyError,
  FileNotFoundForEditError,
  BinaryFileEditError,
  OverlappingHunkError,
  ReplaceLinesNotEnabledError,
  SearchTextNotFoundError,
  StaleRangeHashError,
  WriteScopeDeniedError,
  type EditFormat,
  type EditToolName,
} from "./errors.js";
import { atomicRemoveFile, atomicWriteFile } from "./atomic-write.js";
import {
  applyMatchedReplacement,
  findHeaderAnchorEnds,
  FourTierMatcher,
  snapMatchToWholeLines,
  type UniqueMatch,
} from "./four-tier-matcher.js";
import { findClosestRegion } from "./fuzzy.js";
import { hashFileContent } from "./hash.js";
import { parseOpenAiApplyPatch, type ParsedPatchOperation, type ParsedUpdateHunk } from "./parse-apply-patch.js";
import { parseSearchReplaceBlocks, type SearchReplaceBlock } from "./parse-search-replace.js";
import { resolveEditPath, type ResolvedEditPath } from "./paths.js";
import { type ModelProfileEditView, type WindowedFileReaderPort } from "./ports.js";
import { EditRecoveryTracker, type RecoveryFailure } from "./recovery.js";
import { pathMatchesWriteScope } from "./scope.js";
import {
  changedLineRegion,
  detectElision,
  hashLineRange,
  lineNumberAt,
  lineRangeBounds,
  numberedView,
} from "./text.js";

export interface EditApplySuccess {
  readonly filesWritten: readonly string[];
  readonly filesDeleted: readonly string[];
}

export interface EditToolDispatcherOptions {
  readonly worktreePath: string;
  readonly writeScope: readonly string[];
  readonly attemptId: string;
  readonly modelProfile: ModelProfileEditView;
  readonly fileReader: WindowedFileReaderPort;
  readonly recovery?: EditRecoveryTracker;
  readonly matcher?: FourTierMatcher;
}

interface PlannedFile {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly next: string | null;
}

export function offeredEditTools(editFormat: EditFormat): readonly EditToolName[] {
  return [editFormat, "write_new_file"];
}

/**
 * Applies the one edit format a model family was trained on.
 * Formatting is intentionally not run here; the step executor formats at submit time.
 */
export class EditToolDispatcher {
  private readonly worktreePath: string;
  private readonly writeScope: readonly string[];
  private readonly attemptId: string;
  private readonly modelProfile: ModelProfileEditView;
  private readonly fileReader: WindowedFileReaderPort;
  private readonly recovery: EditRecoveryTracker;
  private readonly matcher: FourTierMatcher;

  constructor(options: EditToolDispatcherOptions) {
    if (options.attemptId.trim() === "") {
      throw new Error("attemptId is required");
    }
    this.worktreePath = options.worktreePath;
    this.writeScope = options.writeScope;
    this.attemptId = options.attemptId;
    this.modelProfile = options.modelProfile;
    this.fileReader = options.fileReader;
    this.recovery = options.recovery ?? new EditRecoveryTracker();
    this.matcher = options.matcher ?? new FourTierMatcher();
  }

  availableTools(relativePath?: string): readonly EditToolName[] {
    const tools: EditToolName[] = [this.modelProfile.editFormat, "write_new_file"];
    if (
      relativePath !== undefined &&
      this.recovery.isReplaceLinesEnabled(this.attemptId, relativePath)
    ) {
      tools.push("replace_lines");
    }
    return tools;
  }

  applyPatch(patchText: string): EditApplySuccess {
    this.assertOffered("apply_patch");
    const parsed = parseOpenAiApplyPatch(patchText);
    for (const operation of parsed.operations) {
      this.resolveInScope(operation.path);
      if (operation.kind === "update" && operation.moveTo !== undefined) {
        this.resolveInScope(operation.moveTo);
      }
      this.assertNoElision(operation);
    }
    const planned = new Map<string, PlannedFile>();
    for (const operation of parsed.operations) {
      if (operation.kind === "add") this.planAdd(planned, operation.path, operation.content);
      else if (operation.kind === "delete") this.planDelete(planned, operation.path);
      else this.planUpdate(planned, operation.path, operation.hunks, operation.moveTo);
    }
    return this.commit(planned);
  }

  strReplace(filePath: string, oldText: string, newText: string): EditApplySuccess {
    this.assertOffered("str_replace");
    return this.applyReplacements([{ path: filePath, search: oldText, replace: newText }]);
  }

  searchReplace(input: string | readonly SearchReplaceBlock[]): EditApplySuccess {
    this.assertOffered("search_replace");
    const blocks = typeof input === "string" ? parseSearchReplaceBlocks(input) : input;
    return this.applyReplacements(blocks);
  }

  writeNewFile(filePath: string, content: string): EditApplySuccess {
    const placeholder = detectElision(content);
    if (placeholder) throw new ElisionPlaceholderError(placeholder);
    const planned = new Map<string, PlannedFile>();
    this.planAdd(planned, filePath, content);
    return this.commit(planned);
  }

  replaceLines(
    filePath: string,
    start: number,
    end: number,
    text: string,
    rangeHash: string,
  ): EditApplySuccess {
    const resolved = this.resolveInScope(filePath);
    if (!this.recovery.isReplaceLinesEnabled(this.attemptId, resolved.relativePath)) {
      throw new ReplaceLinesNotEnabledError(resolved.relativePath);
    }
    const placeholder = detectElision(text);
    if (placeholder) throw new ElisionPlaceholderError(placeholder);
    const content = this.readDisk(resolved);
    if (content === null) throw new FileNotFoundForEditError(resolved.relativePath);
    const bounds = lineRangeBounds(content, start, end, resolved.relativePath);
    const currentRangeHash = hashLineRange(content, start, end, resolved.relativePath);
    if (currentRangeHash !== rangeHash) {
      throw new StaleRangeHashError({
        path: resolved.relativePath,
        start,
        end,
        expectedHash: rangeHash,
        currentRangeHash,
        currentLines: numberedView(content, start, end),
      });
    }
    const match: UniqueMatch = {
      tier: 1,
      startOffset: bounds.start,
      endOffset: bounds.end,
      startLine: start,
      endLine: end,
      fileBaseIndent: "",
      matchedText: content.slice(bounds.start, bounds.end),
    };
    const planned = new Map<string, PlannedFile>();
    this.remember(planned, resolved, applyMatchedReplacement(content, match, text));
    return this.commit(planned);
  }

  private applyReplacements(blocks: readonly SearchReplaceBlock[]): EditApplySuccess {
    if (blocks.length === 0) throw new EmptySearchTextError();
    for (const block of blocks) {
      const placeholder = detectElision(block.replace);
      if (placeholder) throw new ElisionPlaceholderError(placeholder);
      if (block.search.length === 0) throw new EmptySearchTextError();
      this.resolveInScope(block.path);
    }
    const planned = new Map<string, PlannedFile>();
    for (const block of blocks) {
      this.planReplace(planned, block.path, block.search, block.replace);
    }
    return this.commit(planned);
  }

  private assertOffered(tool: EditFormat): void {
    if (this.modelProfile.editFormat !== tool) {
      throw new EditToolNotOfferedError(tool, this.modelProfile.editFormat);
    }
  }

  private assertNoElision(operation: ParsedPatchOperation): void {
    if (operation.kind === "add") {
      const placeholder = detectElision(operation.content);
      if (placeholder) throw new ElisionPlaceholderError(placeholder);
      return;
    }
    if (operation.kind !== "update") return;
    for (const hunk of operation.hunks) {
      const placeholder = detectElision(hunk.insertedLines.join("\n"));
      if (placeholder) throw new ElisionPlaceholderError(placeholder);
    }
  }

  private resolveInScope(requested: string): ResolvedEditPath {
    const resolved = resolveEditPath(this.worktreePath, requested);
    if (!pathMatchesWriteScope(resolved.relativePath, this.writeScope)) {
      throw new WriteScopeDeniedError(resolved.relativePath);
    }
    return resolved;
  }

  private readDisk(resolved: ResolvedEditPath): string | null {
    if (!fs.existsSync(resolved.absolutePath)) return null;
    const content = fs.readFileSync(resolved.absolutePath, "utf8");
    if (content.includes("\0")) throw new BinaryFileEditError(resolved.relativePath);
    const observed = this.fileReader.observedContentHash(this.attemptId, resolved.relativePath);
    if (observed !== undefined && observed !== hashFileContent(content)) {
      const previous = this.fileReader.observedContent?.(this.attemptId, resolved.relativePath);
      const region = changedLineRegion(previous, content);
      throw new FileChangedExternallyError(
        resolved.relativePath,
        numberedView(content, region.start, region.end),
      );
    }
    return content;
  }

  private currentText(resolved: ResolvedEditPath, planned: ReadonlyMap<string, PlannedFile>): string | null {
    const existing = planned.get(resolved.relativePath);
    if (existing) return existing.next;
    return this.readDisk(resolved);
  }

  private remember(planned: Map<string, PlannedFile>, resolved: ResolvedEditPath, next: string | null): void {
    planned.set(resolved.relativePath, {
      absolutePath: resolved.absolutePath,
      relativePath: resolved.relativePath,
      next,
    });
  }

  private planAdd(planned: Map<string, PlannedFile>, filePath: string, content: string): void {
    const resolved = this.resolveInScope(filePath);
    const existing = this.currentText(resolved, planned);
    if (existing !== null) {
      throw new FileAlreadyExistsError(this.modelProfile.editFormat, resolved.relativePath);
    }
    this.remember(planned, resolved, content);
  }

  private planDelete(planned: Map<string, PlannedFile>, filePath: string): void {
    const resolved = this.resolveInScope(filePath);
    const existing = this.currentText(resolved, planned);
    if (existing === null) throw new FileNotFoundForEditError(resolved.relativePath);
    this.remember(planned, resolved, null);
  }

  private planReplace(
    planned: Map<string, PlannedFile>,
    filePath: string,
    search: string,
    replacement: string,
  ): void {
    const resolved = this.resolveInScope(filePath);
    const content = this.currentText(resolved, planned);
    if (content === null) throw new FileNotFoundForEditError(resolved.relativePath);
    try {
      const match = this.matcher.match(content, search);
      this.remember(planned, resolved, applyMatchedReplacement(content, match, replacement));
    } catch (error) {
      this.rethrowMatch(resolved.relativePath, content, search, error);
    }
  }

  private planUpdate(
    planned: Map<string, PlannedFile>,
    filePath: string,
    hunks: readonly ParsedUpdateHunk[],
    moveTo: string | undefined,
  ): void {
    const resolved = this.resolveInScope(filePath);
    const content = this.currentText(resolved, planned);
    if (content === null) throw new FileNotFoundForEditError(resolved.relativePath);
    const next = hunks.length === 0 ? content : this.applyHunks(resolved.relativePath, content, hunks);
    if (moveTo === undefined) {
      this.remember(planned, resolved, next);
      return;
    }
    const destination = this.resolveInScope(moveTo);
    if (destination.relativePath === resolved.relativePath) {
      this.remember(planned, resolved, next);
      return;
    }
    const occupied = this.currentText(destination, planned);
    if (occupied !== null) {
      throw new FileAlreadyExistsError(this.modelProfile.editFormat, destination.relativePath);
    }
    this.remember(planned, resolved, null);
    this.remember(planned, destination, next);
  }

  private applyHunks(relativePath: string, content: string, hunks: readonly ParsedUpdateHunk[]): string {
    const edits: { readonly match: UniqueMatch; readonly replacement: string }[] = [];
    for (const hunk of hunks) {
      const replacement = hunk.newLines.join("\n");
      const meaningful = hunk.headers.some((header) => header.trim().length > 0);
      const anchors = meaningful ? findHeaderAnchorEnds(content, hunk.headers) : null;
      if (hunk.oldLines.length === 0) {
        edits.push({
          match: this.insertionMatch(relativePath, content, hunk, anchors),
          replacement,
        });
        continue;
      }
      const search = hunk.oldLines.join("\n");
      try {
        const match = snapMatchToWholeLines(content, this.matcher.matchAnchored(content, search, anchors));
        edits.push({ match, replacement });
      } catch (error) {
        this.rethrowMatch(relativePath, content, search.length > 0 ? search : hunk.headers.join("\n"), error);
      }
    }
    const ordered = [...edits].sort((left, right) => left.match.startOffset - right.match.startOffset);
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      if (!previous || !current) continue;
      const overlaps = current.match.startOffset < previous.match.endOffset;
      const samePoint =
        current.match.startOffset === previous.match.startOffset &&
        current.match.endOffset === previous.match.endOffset;
      if (overlaps || samePoint) throw new OverlappingHunkError(relativePath);
    }
    let next = content;
    const reversed = [...edits].sort((left, right) => right.match.startOffset - left.match.startOffset);
    for (const edit of reversed) {
      next = applyMatchedReplacement(next, edit.match, edit.replacement);
    }
    return next;
  }

  private insertionMatch(
    relativePath: string,
    content: string,
    hunk: ParsedUpdateHunk,
    anchors: readonly number[] | null,
  ): UniqueMatch {
    const probe = hunk.headers.filter((header) => header.trim().length > 0).join("\n") || " ";
    if (anchors === null || anchors.length === 0) {
      this.rethrowMatch(relativePath, content, probe, new SearchTextNotFoundError());
    }
    if (!anchors || anchors.length !== 1) {
      const lines = (anchors ?? []).map((offset) => lineNumberAt(content, offset));
      this.rethrowMatch(relativePath, content, probe, new AmbiguousEditMatchError(lines));
    }
    const offset = anchors?.[0] ?? 0;
    return {
      tier: 1,
      startOffset: offset,
      endOffset: offset,
      startLine: lineNumberAt(content, offset),
      endLine: lineNumberAt(content, offset),
      fileBaseIndent: "",
      matchedText: "",
    };
  }

  private rethrowMatch(relativePath: string, content: string, search: string, error: unknown): never {
    if (error instanceof SearchTextNotFoundError) {
      throw this.recoveryFor(relativePath, content, search);
    }
    if (error instanceof AmbiguousEditMatchError) {
      const failure = this.recoveryFor(relativePath, content, search);
      if (failure instanceof EditStuckEscalation) throw failure;
      throw error;
    }
    throw error;
  }

  private recoveryFor(relativePath: string, content: string, search: string): RecoveryFailure {
    const closest = findClosestRegion(content, search.length > 0 ? search : " ");
    const snippet = closest.snippet.length > 500 ? `${closest.snippet.slice(0, 500)}\u2026` : closest.snippet;
    return this.recovery.recordMatchFailure(this.attemptId, relativePath, {
      startLine: closest.startLine,
      endLine: closest.endLine,
      snippet,
      numberedView: numberedView(content, closest.startLine, closest.endLine),
      rangeHash: hashLineRange(content, closest.startLine, closest.endLine, relativePath),
    });
  }

  private commit(planned: ReadonlyMap<string, PlannedFile>): EditApplySuccess {
    const written: string[] = [];
    const deleted: string[] = [];
    const snapshots: { readonly absolutePath: string; readonly content: string | null }[] = [];
    try {
      for (const plan of planned.values()) {
        if (plan.next === null) continue;
        const previous = fs.existsSync(plan.absolutePath) ? fs.readFileSync(plan.absolutePath, "utf8") : null;
        if (previous === plan.next) continue;
        snapshots.push({ absolutePath: plan.absolutePath, content: previous });
        atomicWriteFile(plan.absolutePath, plan.next);
        written.push(plan.relativePath);
      }
      for (const plan of planned.values()) {
        if (plan.next !== null) continue;
        if (!fs.existsSync(plan.absolutePath)) continue;
        atomicRemoveFile(plan.absolutePath);
        deleted.push(plan.relativePath);
      }
    } catch (error) {
      for (const snapshot of snapshots.reverse()) {
        if (snapshot.content === null) {
          if (fs.existsSync(snapshot.absolutePath)) {
            try {
              fs.rmSync(snapshot.absolutePath, { force: true });
            } catch (cleanupError) {
              void cleanupError;
            }
          }
        } else {
          atomicWriteFile(snapshot.absolutePath, snapshot.content);
        }
      }
      throw error;
    }
    for (const plan of planned.values()) {
      this.recovery.recordSuccess(this.attemptId, plan.relativePath);
    }
    return { filesWritten: written, filesDeleted: deleted };
  }
}
