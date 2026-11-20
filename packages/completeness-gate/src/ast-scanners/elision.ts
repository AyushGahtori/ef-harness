import type { StaticAuditFinding } from "./types.js";
import { findingAt } from "./locate.js";

const ELISION_PATTERNS: readonly { readonly expression: RegExp; readonly message: string }[] = [
  {
    expression: /\/\/\s*\.\.\.\s*existing code\s*\.\.\./gi,
    message: "Truncated-file marker comments out existing code.",
  },
  {
    expression: /\/\/\s*\.\.\.\s*rest of (?:the )?file\s*\.\.\./gi,
    message: "Truncated-file marker drops the rest of the file.",
  },
  {
    expression: /\/\*\s*unchanged\s*\*\//gi,
    message: "Truncated-file marker claims a region is unchanged.",
  },
  {
    expression: /^[ \t]*#[ \t]+\.\.\.(?:[ \t].*)?$/gm,
    message: "Truncated-file marker uses a hash elision line.",
  },
];

export function scanElision(file: string, text: string): StaticAuditFinding[] {
  const findings: StaticAuditFinding[] = [];
  for (const pattern of ELISION_PATTERNS) {
    for (const match of text.matchAll(pattern.expression)) {
      findings.push(
        findingAt({
          ruleId: "elision-placeholder",
          severity: "hard",
          file,
          text,
          index: match.index ?? 0,
          message: pattern.message,
          remediation: "Write the real file contents. Do not leave an elision placeholder in the candidate.",
        }),
      );
    }
  }
  return findings;
}

export function unplannedDeletionFinding(
  file: string,
  deletions: number,
  originalLines: number,
): StaticAuditFinding {
  const percent = Math.round((deletions / originalLines) * 100);
  return {
    ruleId: "unplanned-large-deletion",
    severity: "hard",
    file,
    line: 1,
    column: 1,
    snippet: `${deletions} of ${originalLines} lines deleted`,
    message: `Unplanned deletion removed ${percent}% of ${file} (${deletions} of ${originalLines} lines).`,
    remediation: "Restore the deleted lines, or use a task brief that declares the deletion.",
  };
}

export function deletionExceedsLimit(deletions: number, originalLines: number): boolean {
  return originalLines > 0 && deletions * 2 > originalLines;
}
