import type { RequiredCheckRef } from "./types.js";

/** V1 cross-cutting rules. Only rules listed as in-scope for the attempt are mandatory. */
export const CROSS_CUTTING_RULE_IDS = [
  "X-01",
  "X-02",
  "X-03",
  "X-04",
  "X-05",
  "X-06",
  "X-07",
  "X-08",
  "X-09",
  "X-10",
  "X-11",
  "X-12",
  "X-13",
  "X-14",
] as const;

export type CrossCuttingRuleId = (typeof CROSS_CUTTING_RULE_IDS)[number];

const CROSS_CUTTING_RULE_SET: ReadonlySet<string> = new Set(CROSS_CUTTING_RULE_IDS);

export function isCrossCuttingRuleId(value: string): value is CrossCuttingRuleId {
  return CROSS_CUTTING_RULE_SET.has(value);
}

/** Rule ids declared in scope that `state.db` did not link to a required check. */
export function missingInScopeRules(
  required: readonly RequiredCheckRef[],
  inScopeRuleIds: readonly string[],
): string[] {
  const present = new Set<string>();
  for (const check of required) {
    if (check.ruleId !== null) present.add(check.ruleId);
  }
  const missing: string[] = [];
  for (const ruleId of inScopeRuleIds) {
    if (!present.has(ruleId)) missing.push(ruleId);
  }
  return missing;
}
