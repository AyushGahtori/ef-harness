import type { AddedLine } from "./diff-lines.js";
import { makeFinding } from "./findings.js";
import {
  isBuiltinTestConfig,
  isSnapshotPath,
  lineSnippet,
  matchAny,
  normalizePath,
} from "./path-match.js";
import type { StaticAuditFinding } from "./types.js";

export interface TamperFile {
  readonly path: string;
  readonly content: string;
  readonly added: readonly AddedLine[];
}

export function scanTestTampering(
  files: readonly TamperFile[],
  protectedTests: readonly string[],
  protectedConfigs: readonly string[],
  lockedSnapshots: readonly string[],
  verificationScopeGrant: boolean,
): StaticAuditFinding[] {
  const findings: StaticAuditFinding[] = [];
  for (const file of files) {
    const path = normalizePath(file.path);
    const protectedPath =
      matchAny(path, protectedTests) ||
      matchAny(path, protectedConfigs) ||
      matchAny(path, lockedSnapshots) ||
      isBuiltinTestConfig(path) ||
      isSnapshotPath(path);
    if (protectedPath && !verificationScopeGrant) {
      findings.push(
        makeFinding({
          ruleId: "check7.protected-path",
          file: path,
          line: 1,
          column: 1,
          snippet: lineSnippet(file.content, 1),
          message: `Diff touches protected test, runner config, or snapshot path ${path}.`,
          remediation: "Restore the protected file. Tests and runner config are read-only without a verification-scope grant.",
        }),
      );
    }
    for (const line of file.added) {
      const skip = skipKind(line.text);
      if (skip) {
        findings.push(
          makeFinding({
            ruleId: "check7.skip-or-only",
            file: path,
            line: line.line,
            column: 1,
            snippet: line.text.trim().slice(0, 180),
            message: `Newly introduced test tamper "${skip}" is not allowed.`,
            remediation: "Delete the skip, only, fixme, or commented expectation and make the check run.",
          }),
        );
      }
    }
  }
  return findings;
}

function skipKind(text: string): string | null {
  if (/\.(?:skip|only|fixme)\s*\(/.test(text)) return "skip-or-only";
  if (/\b(?:xit|xdescribe|xtest|xspecify)\s*\(/.test(text)) return "xit-or-xdescribe";
  if (/\b(?:it|test|describe|context|specify)\.(?:skip|only|fixme)\b/.test(text)) {
    return "test-modifier";
  }
  if (/^\s*\/\/.*\bexpect\s*\(/.test(text) || /^\s*\/\*.*\bexpect\s*\(/.test(text)) {
    return "commented-expect";
  }
  return null;
}
