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
  const hunksByFile = new Map<string, ConflictHunk[]>();
  for (const hunk of conflictHunks) {
    const file = normalizePath(hunk.file);
    const list = hunksByFile.get(file) ?? [];
    list.push(hunk);
    hunksByFile.set(file, list);
  }
  for (const file of files) {
    const paths = [normalizePath(file.path)];
    if (file.previousPath) paths.push(normalizePath(file.previousPath));
    for (const path of paths) {
      if (actor !== "integrator") {
        if (matchAny(path, writeScope)) continue;
        findings.push(
          makeFinding({
            ruleId: "check11.out-of-scope",
            file: path,
            line: file.added[0]?.line ?? 1,
            column: 1,
            snippet: path,
            message: `Edit ${path} is outside task-packet write_scope.`,
            remediation: "Revert the file or move the change into the task write scope.",
          }),
        );
        continue;
      }
      if (shared.has(path)) continue;
      const hunks = hunksByFile.get(path);
      if (!hunks || hunks.length === 0) {
        findings.push(
          makeFinding({
            ruleId: "check11.out-of-scope",
            file: path,
            line: file.added[0]?.line ?? 1,
            column: 1,
            snippet: path,
            message: `Integrator edit ${path} is outside conflict hunks and declared shared files.`,
            remediation: "Revert the file or move the change into the task write scope.",
          }),
        );
        continue;
      }
      const outsideLine = file.added.find(
        (line) => !hunks.some((hunk) => line.line >= hunk.startLine && line.line <= hunk.endLine),
      );
      if (outsideLine) {
        findings.push(
          makeFinding({
            ruleId: "check11.out-of-scope",
            file: path,
            line: outsideLine.line,
            column: 1,
            snippet: outsideLine.text.trim().slice(0, 180) || path,
            message: `Integrator edit ${path}:${outsideLine.line} is outside conflict hunk lines.`,
            remediation: "Keep integrator conflict edits inside the declared conflict hunks.",
          }),
        );
      }
    }
  }
  return findings;
}
