import type { FindingSeverity, StaticAuditFinding } from "./types.js";

export function makeFinding(input: {
  readonly ruleId: string;
  readonly severity?: FindingSeverity;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly snippet: string;
  readonly message: string;
  readonly remediation: string;
}): StaticAuditFinding {
  return {
    ruleId: input.ruleId,
    severity: input.severity ?? "hard",
    file: input.file,
    line: input.line,
    column: input.column,
    snippet: input.snippet,
    message: input.message,
    remediation: input.remediation,
  };
}
