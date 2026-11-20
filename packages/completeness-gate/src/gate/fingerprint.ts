import { createHash } from "node:crypto";
import type { StaticAuditFinding } from "./types.js";

/** Identical hard-finding sets always hash to the same fingerprint. */
export function computeStaticAuditFingerprint(findings: readonly StaticAuditFinding[]): string {
  const hard = findings.filter((finding) => finding.severity === "hard");
  const canon = hard
    .map((finding) =>
      [
        finding.ruleId,
        finding.file,
        String(finding.line),
        String(finding.column),
        finding.message,
      ].join("|"),
    )
    .sort()
    .join("\n");
  return createHash("sha256").update(canon).digest("hex");
}
