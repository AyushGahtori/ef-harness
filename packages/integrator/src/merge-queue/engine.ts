import { readFileSync } from "node:fs";
import path from "node:path";
import { ProjectIntegratorV1Schema } from "@ef-harness/shared-contracts";
import { completeOffline } from "../model-adapter.js";
import { MAX_INTEGRATOR_ATTEMPTS } from "./constants.js";
import { assertSidesKept, hasConflictMarkers, unionConflictText } from "./conflicts.js";
import { DroppedSideError, InvalidIntegratorOutputError, TestWeakeningError } from "./errors.js";
import { orderMigrations, renderMigrationAst, timestampName } from "./migrations.js";
import { isBlockedOutput, parseProjectIntegratorV1 } from "./schema.js";
import { assertNoTestWeakening } from "./test-weakening.js";
import type {
  FeatureCanonicalSpec,
  FileReplacement,
  IntegratorPromptInput,
  ProjectIntegratorModel,
} from "./types.js";

export interface EngineResolution {
  readonly ok: boolean;
  readonly reason: string;
  readonly detail: string;
  readonly files: readonly FileReplacement[];
  readonly prompt: string;
}

/**
 * project-integrator@1. The model sees conflicting hunks, both specs, and the migration AST only.
 */
export class ProjectIntegratorEngine {
  readonly prompts: string[] = [];
  private readonly model: ProjectIntegratorModel;

  constructor(model?: ProjectIntegratorModel) {
    this.model = model ?? defaultModel;
  }

  buildPrompt(input: IntegratorPromptInput): string {
    const conflictText = input.conflicts
      .map((hunk) => {
        const before = hunk.contextBefore.join("\n");
        const after = hunk.contextAfter.join("\n");
        return [
          `path: ${hunk.path}`,
          "context-before:",
          before,
          "ours:",
          hunk.ours.join("\n"),
          "theirs:",
          hunk.theirs.join("\n"),
          "context-after:",
          after,
        ].join("\n");
      })
      .join("\n---\n");
    const specs = input.specs
      .map((spec) => {
        const contracts = spec.contracts.map((contract) => `${contract.id}: ${contract.text}`).join("\n");
        return [`feature: ${spec.id}`, spec.title, spec.text, contracts].join("\n");
      })
      .join("\n---\n");
    const checks = input.failingChecks
      .map((check) => `${check.id} owners=${check.owners.join("|")} ${check.trace}`)
      .join("\n");
    const commits = input.offendingCommits
      .map((commit) => `${commit.featureId} ${commit.sha} ${commit.subject}`)
      .join("\n");
    return [
      "project-integrator@1",
      "conflicts:",
      conflictText,
      "specs:",
      specs,
      "migration-ast:",
      input.migrationAst,
      "migration-issues:",
      input.migrationIssues.map((issue) => `${issue.code} ${issue.detail}`).join("\n"),
      "failing-checks:",
      checks,
      "offending-commits:",
      commits,
    ].join("\n");
  }

  async resolve(
    input: IntegratorPromptInput & {
      readonly worktree: string;
      readonly beforeFiles: readonly { path: string; text: string }[];
      readonly conflictOriginals: readonly { path: string; text: string }[];
    },
  ): Promise<EngineResolution> {
    const prompt = this.buildPrompt(input);
    this.prompts.push(prompt);
    let files: FileReplacement[] = [];
    try {
      const treeFiles = input.beforeFiles.map((file) => ({
        path: file.path.replaceAll("\\", "/"),
        text: file.text,
      }));
      const candidate = await Promise.resolve(this.model({
        attempt: input.attempt,
        featureIds: input.featureIds,
        conflicts: input.conflicts,
        specs: input.specs,
        migrationAst: input.migrationAst,
        migrationIssues: input.migrationIssues,
        failingChecks: input.failingChecks,
        offendingCommits: input.offendingCommits,
        treeFiles,
        prompt,
      }));
      let output = candidate.output;
      try {
        const echoed = await completeOffline("project-integrator@1", candidate.output);
        const shared = ProjectIntegratorV1Schema.safeParse(echoed);
        if (shared.success) {
          parseProjectIntegratorV1(shared.data);
          output = shared.data;
        }
      } catch {
        output = candidate.output;
      }
      const parsed = parseProjectIntegratorV1(output);
      if (isBlockedOutput(parsed)) {
        return { ok: false, reason: "blocked", detail: parsed.reason, files: [], prompt };
      }
      files = (candidate.files ?? []).map((file) => ({
        path: file.path.replaceAll("\\", "/"),
        text: file.text,
      }));
      const after = applyPreview(input.beforeFiles, files);
      assertNoTestWeakening(input.beforeFiles, after);
      for (const original of input.conflictOriginals) {
        const next = after.find((file) => file.path === original.path.replaceAll("\\", "/"));
        if (!next) throw new DroppedSideError(original.path, "resolved file missing");
        if (next.text !== null && hasConflictMarkers(next.text)) {
          throw new DroppedSideError(original.path, "unresolved conflict marker");
        }
        assertSidesKept(original.path, original.text, next.text ?? "");
      }
      if (input.migrationIssues.length > 0 && parsed.migrations_order.length === 0) {
        throw new InvalidIntegratorOutputError("migrations_order is required when migration issues exist");
      }
      return { ok: true, reason: "resolved", detail: parsed.rerun_suites.join(","), files, prompt };
    } catch (error) {
      if (
        error instanceof TestWeakeningError ||
        error instanceof DroppedSideError ||
        error instanceof InvalidIntegratorOutputError
      ) {
        return { ok: false, reason: error.code, detail: error.message, files: [], prompt };
      }
      throw error;
    }
  }
}

export function defaultModel(input: IntegratorPromptInput & { readonly prompt: string }): {
  output: unknown;
  files: FileReplacement[];
} {
  const files: FileReplacement[] = [];
  const migrationIds: string[] = [];
  if (input.migrationIssues.length > 0 && Array.isArray(input.migrationIssues)) {
    const current = readNamed(input, "migrations");
    const ordered = orderMigrations(current);
    ordered.forEach((file, index) => {
      const slug = path.posix.basename(file.file, ".sql");
      const next = `migrations/${timestampName(index, file.sql, slug)}`;
      migrationIds.push(next);
      if (next !== file.file) {
        files.push({ path: file.file, text: null });
        files.push({ path: next, text: file.sql.endsWith("\n") ? file.sql : `${file.sql}\n` });
      }
    });
  }
  for (const hunk of input.conflicts) {
    const original = inputNamed(input, hunk.path);
    if (original === null) continue;
    files.push({ path: hunk.path, text: unionConflictText(original) });
  }
  return {
    output: {
      migrations_order: migrationIds,
      ccr_decisions: [],
      rerun_suites: input.failingChecks.map((check) => check.id),
    },
    files,
  };
}

function inputNamed(input: IntegratorPromptInput, filePath: string): string | null {
  const found = input.treeFiles?.find((file) => file.path === filePath);
  return found ? found.text : null;
}

function readNamed(input: IntegratorPromptInput, prefix: string): { file: string; sql: string }[] {
  return (input.treeFiles ?? [])
    .filter((file) => file.path.startsWith(`${prefix}/`) && file.path.endsWith(".sql"))
    .map((file) => ({ file: file.path, sql: file.text }));
}

function applyPreview(
  before: readonly { path: string; text: string }[],
  files: readonly FileReplacement[],
): { path: string; text: string }[] {
  const map = new Map(before.map((file) => [file.path.replaceAll("\\", "/"), file.text]));
  for (const file of files) {
    if (file.text === null) map.delete(file.path);
    else map.set(file.path, file.text);
  }
  return [...map.entries()].map(([filePath, text]) => ({ path: filePath, text }));
}

export function readTreeFiles(worktree: string, relativePaths: readonly string[]): { path: string; text: string }[] {
  const files: { path: string; text: string }[] = [];
  for (const relative of relativePaths) {
    try {
      const text = readFileSync(path.join(worktree, relative), "utf8");
      files.push({ path: relative.replaceAll("\\", "/"), text });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }
  }
  return files;
}

export { MAX_INTEGRATOR_ATTEMPTS, renderMigrationAst };

export function collectSpecs(specs: readonly FeatureCanonicalSpec[]): FeatureCanonicalSpec[] {
  const seen = new Set<string>();
  const unique: FeatureCanonicalSpec[] = [];
  for (const spec of specs) {
    if (seen.has(spec.id)) continue;
    seen.add(spec.id);
    unique.push(spec);
  }
  return unique;
}
