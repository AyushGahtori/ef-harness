import { createHash } from "node:crypto";
import type { StaticAuditFinding } from "./types.js";
import { normalizePath } from "./paths.js";

/**
 * Identity of a hard-finding set for the 3× static-audit escalation.
 * Line and column are omitted so inserting a blank line does not mint a new
 * fingerprint for the same violation. Multiplicity is preserved: two copies
 * of the same snippet are a different set from one copy.
 */
export function computeStaticAuditFingerprint(findings: readonly StaticAuditFinding[]): string {
  const projected = findings
    .filter((item) => item.severity === "hard")
    .map((item) => ({
      ruleId: item.ruleId,
      file: normalizePath(item.file),
      snippet: item.snippet.replace(/\s+/g, " ").trim(),
    }))
    .sort((left, right) => {
      return (
        left.ruleId.localeCompare(right.ruleId) ||
        left.file.localeCompare(right.file) ||
        left.snippet.localeCompare(right.snippet)
      );
    });
  return createHash("sha256").update(JSON.stringify(projected)).digest("hex");
}
