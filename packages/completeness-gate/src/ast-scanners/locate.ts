import type { StaticAuditFinding, StaticAuditSeverity } from "./types.js";
import { normalizePath } from "./paths.js";

export function positionAt(text: string, index: number): { readonly line: number; readonly column: number } {
  let line = 1;
  let column = 1;
  const end = Math.min(index, text.length);
  for (let i = 0; i < end; i += 1) {
    const ch = text[i];
    if (ch === "\n") {
      line += 1;
      column = 1;
      continue;
    }
    if (ch === "\r") continue;
    column += 1;
  }
  return { line, column };
}

export function lineText(text: string, line: number): string {
  const lines = text.split(/\r?\n/);
  return lines[line - 1] ?? "";
}

export function makeFinding(input: {
  readonly ruleId: string;
  readonly severity: StaticAuditSeverity;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly snippet: string;
  readonly message: string;
  readonly remediation: string;
}): StaticAuditFinding {
  const snippet = input.snippet.replace(/\s+/g, " ").trim().slice(0, 240);
  return {
    ruleId: input.ruleId,
    severity: input.severity,
    file: normalizePath(input.file),
    line: input.line,
    column: input.column,
    snippet: snippet.length > 0 ? snippet : input.ruleId,
    message: input.message,
    remediation: input.remediation,
  };
}

export function findingAt(input: {
  readonly ruleId: string;
  readonly severity: StaticAuditSeverity;
  readonly file: string;
  readonly text: string;
  readonly index: number;
  readonly message: string;
  readonly remediation: string;
}): StaticAuditFinding {
  const position = positionAt(input.text, input.index);
  return makeFinding({
    ruleId: input.ruleId,
    severity: input.severity,
    file: input.file,
    line: position.line,
    column: position.column,
    snippet: lineText(input.text, position.line),
    message: input.message,
    remediation: input.remediation,
  });
}

export function dedupeFindings(findings: readonly StaticAuditFinding[]): StaticAuditFinding[] {
  const seen = new Set<string>();
  const unique: StaticAuditFinding[] = [];
  for (const item of findings) {
    const key = [item.ruleId, item.severity, item.file, String(item.line), String(item.column), item.snippet].join(
      "\0",
    );
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

export function sortFindings(findings: readonly StaticAuditFinding[]): StaticAuditFinding[] {
  return [...findings].sort((left, right) => {
    return (
      left.file.localeCompare(right.file) ||
      left.line - right.line ||
      left.column - right.column ||
      left.ruleId.localeCompare(right.ruleId) ||
      left.snippet.localeCompare(right.snippet) ||
      left.message.localeCompare(right.message)
    );
  });
}
