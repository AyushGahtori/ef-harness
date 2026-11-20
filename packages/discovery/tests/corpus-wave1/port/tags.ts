/**
 * Local port of the Task 010 closed touches registry.
 * Swap for the shared-contracts barrel when Task 010 is integrated.
 */
export const TOUCHES_TAGS = [
  "personal_data",
  "credentials",
  "money",
  "user_content",
  "authn",
  "authz",
  "session",
  "scheduling",
  "time_display",
  "file_upload",
  "file_download",
  "external_api",
  "inbound_webhook",
  "outbound_message",
  "background_job",
  "realtime",
  "destructive_write",
  "bulk_write",
  "migration",
  "search",
  "form_input",
  "route",
  "interactive_ui",
  "logging",
  "config_env",
  "caching",
  "rate_limited",
  "concurrent_edit",
] as const;

export type TouchesTag = (typeof TOUCHES_TAGS)[number];

const TOUCHES_TAG_SET: ReadonlySet<string> = new Set(TOUCHES_TAGS);

export function isTouchesTag(value: string): value is TouchesTag {
  return TOUCHES_TAG_SET.has(value);
}

export const INFERENCE_RULES = [
  "infer.from_explicit_user_span",
  "infer.from_stated_technology",
  "infer.from_repo_dependency",
  "infer.from_stated_audience",
  "infer.from_stated_platform",
  "infer.from_stated_stage",
] as const;

const INFERENCE_RULE_SET: ReadonlySet<string> = new Set(INFERENCE_RULES);

export function isInferenceRule(value: string): boolean {
  return INFERENCE_RULE_SET.has(value);
}
