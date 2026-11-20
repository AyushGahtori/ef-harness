/**
 * Local port of the closed 28-tag registry from Task 010
 * (`packages/shared-contracts/src/vocabularies`). Task 010 is not on this
 * base. Swap this module for that barrel when integration wires it.
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

export function assertTouchesTags(tags: readonly string[], label: string): readonly TouchesTag[] {
  const normalized: TouchesTag[] = [];
  for (const tag of tags) {
    if (!isTouchesTag(tag)) {
      throw new Error(`${label} uses touches tag outside the closed 28-tag registry: ${tag}`);
    }
    normalized.push(tag);
  }
  return normalized;
}
