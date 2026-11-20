/**
 * Local port of the Task 010 closed touches registry.
 * Values mirror v1-knowledge-corpus.md exactly.
 * Swap this module for the Task 010 barrel export when
 * task/010-closed-vocabularies is integrated. Do not invent tags here.
 */
export const TOUCHES_TAG_GROUPS = {
  data_sensitivity: ["personal_data", "credentials", "money", "user_content"],
  identity: ["authn", "authz", "session"],
  time: ["scheduling", "time_display"],
  io: [
    "file_upload",
    "file_download",
    "external_api",
    "inbound_webhook",
    "outbound_message",
    "background_job",
    "realtime",
  ],
  data_operations: ["destructive_write", "bulk_write", "migration", "search"],
  ui: ["form_input", "route", "interactive_ui"],
  operations: ["logging", "config_env", "caching", "rate_limited", "concurrent_edit"],
} as const;

export const TOUCHES_TAGS = [
  ...TOUCHES_TAG_GROUPS.data_sensitivity,
  ...TOUCHES_TAG_GROUPS.identity,
  ...TOUCHES_TAG_GROUPS.time,
  ...TOUCHES_TAG_GROUPS.io,
  ...TOUCHES_TAG_GROUPS.data_operations,
  ...TOUCHES_TAG_GROUPS.ui,
  ...TOUCHES_TAG_GROUPS.operations,
] as const;

export type TouchesTag = (typeof TOUCHES_TAGS)[number];

const TOUCHES_TAG_SET: ReadonlySet<string> = new Set(TOUCHES_TAGS);

export function isTouchesTag(value: string): value is TouchesTag {
  return TOUCHES_TAG_SET.has(value);
}

export function formatTouchesTagList(): string {
  return TOUCHES_TAGS.join(", ");
}
