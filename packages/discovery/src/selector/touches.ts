/**
 * Local port of Task 010's closed 28 touches tags.
 * `@ef-harness/shared-contracts` on this base does not export them.
 * Swap `TOUCHES_TAGS` for the shared-contracts barrel when that wiring lands.
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
