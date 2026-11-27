import { HIGH_RISK_TOUCH_ALIASES, HIGH_RISK_TOUCHES } from "./types.js";
import type { HighRiskTouch } from "./types.js";

const HIGH_RISK = new Set<string>(HIGH_RISK_TOUCHES);

export function canonicalHighRiskTouch(tag: string): HighRiskTouch | null {
  if (HIGH_RISK.has(tag)) return tag as HighRiskTouch;
  return HIGH_RISK_TOUCH_ALIASES[tag] ?? null;
}

export interface RiskGateInput {
  readonly touches: readonly string[];
  readonly hintRetryLevel: number;
  readonly tagDrift: boolean;
}

export interface RiskGateDecision {
  readonly run: boolean;
  readonly reasons: readonly ("high_risk_tag" | "hint_retry" | "tag_drift")[];
}

/**
 * reviewer@1 runs only for high-risk tags, Task 077 tag drift, or Hint 2–3.
 * Hint level 0 and 1 stay on the normal ladder and do not spend review tokens.
 */
export function decideReviewerRisk(input: RiskGateInput): RiskGateDecision {
  const reasons: ("high_risk_tag" | "hint_retry" | "tag_drift")[] = [];
  if (input.touches.some((tag) => canonicalHighRiskTouch(tag) !== null)) {
    reasons.push("high_risk_tag");
  }
  if (input.hintRetryLevel >= 2) reasons.push("hint_retry");
  if (input.tagDrift) reasons.push("tag_drift");
  return { run: reasons.length > 0, reasons };
}
