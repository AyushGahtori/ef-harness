/**
 * Closed touches vocabulary from v1-knowledge-corpus.md.
 * Planners may only emit these tags. New tags require a corpus change.
 */
export const TOUCH_TAGS = [
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

export type TouchTag = (typeof TOUCH_TAGS)[number];

const TOUCH_SET = new Set<string>(TOUCH_TAGS);

export function isTouchTag(value: string): value is TouchTag {
  return TOUCH_SET.has(value);
}
