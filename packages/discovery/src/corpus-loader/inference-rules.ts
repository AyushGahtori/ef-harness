/**
 * Local port of the Task 071 inference-rule allowlist.
 * A question's allowed_inference_rules[] may name only these ids.
 * Swap for the Task 071 export when that branch is integrated.
 */
export const INFERENCE_RULE_ALLOWLIST = [
  "infer.from_explicit_user_span",
  "infer.from_stated_technology",
  "infer.from_repo_dependency",
  "infer.from_stated_audience",
  "infer.from_stated_platform",
  "infer.from_stated_stage",
] as const;

export type InferenceRuleId = (typeof INFERENCE_RULE_ALLOWLIST)[number];

const INFERENCE_RULE_SET: ReadonlySet<string> = new Set(INFERENCE_RULE_ALLOWLIST);

export function isInferenceRuleId(value: string): value is InferenceRuleId {
  return INFERENCE_RULE_SET.has(value);
}
