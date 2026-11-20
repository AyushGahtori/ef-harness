import type { AddedLine } from "./diff-lines.js";
import { makeFinding } from "./findings.js";
import { matchAny, normalizePath } from "./path-match.js";
import type { ConflictHunk, StaticAuditFinding } from "./types.js";

export interface ScopeFile {
  readonly path: string;
  readonly previousPath?: string;
  readonly added: readonly AddedLine[];
}

export function scanOutOfScope(
  files: readonly ScopeFile[],
  actor: "worker" | "integrator" | "human",
  writeScope: readonly string[],
  conflictHunks: readonly ConflictHunk[],
  sharedFiles: readonly string[],
): StaticAuditFinding[] {
  const findings: StaticAuditFinding[] = [];
  const shared = new Set(sharedFiles.map(normalizePath));
  const conflictFiles = new Set(conflictHunks.map((hunk) => normalizePath(hunk.file)));
  for (const file of files) {
    const paths = [normalizePath(file.path)];
    if (file.previousPath) paths.push(normalizePath(file.previousPath));
    for (const path of paths) {
      const allowed =
        actor === "integrator" ? shared.has(path) || conflictFiles.has(path) : matchAny(path, writeScope);
      if (allowed) continue;
      findings.push(
        makeFinding({
          ruleId: "check11.out-of-scope",
          file: path,
          line: file.added[0]?.line ?? 1,
          column: 1,
          snippet: path,
          message:
            actor === "integrator"
              ? `Integrator edit ${path} is outside conflict hunks and declared shared files.`
              : `Edit ${path} is outside task-packet write_scope.`,
          remediation: "Revert the file or move the change into the task write scope.",
        }),
      );
    }
  }
  return findings;
}
