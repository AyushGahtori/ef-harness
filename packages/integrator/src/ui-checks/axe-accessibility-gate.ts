import type { AxeViolation, UiConsistencyFinding } from "./types.js";

const HARD_FAIL_IMPACTS = new Set<AxeViolation["impact"]>(["serious", "critical"]);

export function runAxeAccessibilityGate(violations: readonly AxeViolation[]): UiConsistencyFinding[] {
  const findings: UiConsistencyFinding[] = [];
  for (const violation of violations) {
  const severity = HARD_FAIL_IMPACTS.has(violation.impact) ? "error" : "notice";
    for (const node of violation.nodes) {
      findings.push({
        stage: "axe_accessibility",
        rule: violation.id,
        severity,
        message: `${violation.id} (${violation.impact}): ${violation.description} on ${node.target}`,
        ...(node.source ? { location: node.source } : {}),
      });
    }
  }
  return findings;
}

export function axeGatePassed(findings: readonly UiConsistencyFinding[]): boolean {
  return !findings.some((finding) => finding.stage === "axe_accessibility" && finding.severity === "error");
}