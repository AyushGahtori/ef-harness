import { PatchParseError } from "./errors.js";

export interface ParsedUpdateHunk {
  readonly headers: readonly string[];
  readonly oldLines: readonly string[];
  readonly newLines: readonly string[];
  readonly insertedLines: readonly string[];
}

export interface ParsedAddFile {
  readonly kind: "add";
  readonly path: string;
  readonly content: string;
}

export interface ParsedDeleteFile {
  readonly kind: "delete";
  readonly path: string;
}

export interface ParsedUpdateFile {
  readonly kind: "update";
  readonly path: string;
  readonly moveTo?: string;
  readonly hunks: readonly ParsedUpdateHunk[];
}

export type ParsedPatchOperation = ParsedAddFile | ParsedDeleteFile | ParsedUpdateFile;

export interface ParsedPatch {
  readonly operations: readonly ParsedPatchOperation[];
}

const BEGIN = "*** Begin Patch";
const END = "*** End Patch";
const END_OF_FILE = "*** End of File";
const ADD = "*** Add File:";
const DELETE = "*** Delete File:";
const UPDATE = "*** Update File:";
const MOVE = "*** Move to:";

function normalizePatch(patch: string): string[] {
  return patch.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function markerPath(line: string, prefix: string, lineNumber: number): string {
  const trimmed = line.trimEnd();
  if (!trimmed.startsWith(prefix)) {
    throw new PatchParseError(lineNumber, `expected ${prefix}`);
  }
  const value = trimmed.slice(prefix.length).trim();
  if (value.length === 0) throw new PatchParseError(lineNumber, "missing path");
  return value;
}

interface HunkBuilder {
  headers: string[];
  oldLines: string[];
  newLines: string[];
  insertedLines: string[];
}

function finishHunk(builder: HunkBuilder, hunks: ParsedUpdateHunk[]): void {
  if (
    builder.headers.length === 0 &&
    builder.oldLines.length === 0 &&
    builder.newLines.length === 0 &&
    builder.insertedLines.length === 0
  ) {
    return;
  }
  hunks.push({
    headers: builder.headers,
    oldLines: builder.oldLines,
    newLines: builder.newLines,
    insertedLines: builder.insertedLines,
  });
}

export function parseOpenAiApplyPatch(patch: string): ParsedPatch {
  const lines = normalizePatch(patch);
  let index = 0;
  while (index < lines.length && (lines[index] ?? "").trim() === "") index += 1;
  if ((lines[index] ?? "").trimEnd() !== BEGIN) {
    throw new PatchParseError(index + 1, "patch must start with *** Begin Patch");
  }
  index += 1;
  const operations: ParsedPatchOperation[] = [];
  let ended = false;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const lineNumber = index + 1;
    if (line.trim() === "") {
      index += 1;
      continue;
    }
    if (line.trimEnd() === END) {
      ended = true;
      index += 1;
      break;
    }
    if (line.startsWith(ADD)) {
      const filePath = markerPath(line, ADD, lineNumber);
      index += 1;
      const body: string[] = [];
      while (index < lines.length && !(lines[index] ?? "").startsWith("***")) {
        const bodyLine = lines[index] ?? "";
        if (!bodyLine.startsWith("+")) {
          throw new PatchParseError(index + 1, "add-file lines must start with +");
        }
        body.push(bodyLine.slice(1));
        index += 1;
      }
      const content = body.length === 0 ? "" : `${body.join("\n")}\n`;
      operations.push({ kind: "add", path: filePath, content });
      continue;
    }
    if (line.startsWith(DELETE)) {
      const filePath = markerPath(line, DELETE, lineNumber);
      operations.push({ kind: "delete", path: filePath });
      index += 1;
      continue;
    }
    if (line.startsWith(UPDATE)) {
      const filePath = markerPath(line, UPDATE, lineNumber);
      index += 1;
      let moveTo: string | undefined;
      if ((lines[index] ?? "").startsWith(MOVE)) {
        moveTo = markerPath(lines[index] ?? "", MOVE, index + 1);
        index += 1;
      }
      const hunks: ParsedUpdateHunk[] = [];
      let builder: HunkBuilder = { headers: [], oldLines: [], newLines: [], insertedLines: [] };
      while (index < lines.length && !(lines[index] ?? "").startsWith("***")) {
        const hunkLine = lines[index] ?? "";
        if (hunkLine.trim() === "") {
          index += 1;
          continue;
        }
        if (hunkLine.startsWith("@@")) {
          if (builder.oldLines.length > 0 || builder.newLines.length > 0 || builder.insertedLines.length > 0) {
            finishHunk(builder, hunks);
            builder = { headers: [], oldLines: [], newLines: [], insertedLines: [] };
          }
          const header = hunkLine.slice(2).replace(/^ /, "");
          builder.headers.push(header);
          index += 1;
          continue;
        }
        if (hunkLine.startsWith("+")) {
          const inserted = hunkLine.slice(1);
          builder.newLines.push(inserted);
          builder.insertedLines.push(inserted);
          index += 1;
          continue;
        }
        if (hunkLine.startsWith("-")) {
          builder.oldLines.push(hunkLine.slice(1));
          index += 1;
          continue;
        }
        if (hunkLine.startsWith(" ")) {
          const content = hunkLine.slice(1);
          builder.oldLines.push(content);
          builder.newLines.push(content);
          index += 1;
          continue;
        }
        throw new PatchParseError(index + 1, "hunk line must start with a space, +, -, or @@");
      }
      if ((lines[index] ?? "").trimEnd() === END_OF_FILE) index += 1;
      finishHunk(builder, hunks);
      if (hunks.length === 0 && moveTo === undefined) {
        throw new PatchParseError(lineNumber, "update has no hunks");
      }
      operations.push(moveTo === undefined
        ? { kind: "update", path: filePath, hunks }
        : { kind: "update", path: filePath, moveTo, hunks });
      continue;
    }
    throw new PatchParseError(lineNumber, `unexpected line: ${line}`);
  }
  if (!ended) throw new PatchParseError(lines.length, "patch is missing *** End Patch");
  while (index < lines.length) {
    if ((lines[index] ?? "").trim() !== "") {
      throw new PatchParseError(index + 1, "unexpected trailing content");
    }
    index += 1;
  }
  if (operations.length === 0) throw new PatchParseError(1, "patch has no file operations");
  return { operations };
}
