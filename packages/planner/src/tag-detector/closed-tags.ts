/**
 * Local port of the Task 010 closed touches registry and scope evaluator.
 * Swap this module for `@ef-harness/shared-contracts` vocabularies when that
 * barrel exports them. Scopes stay `{ any?, all? }` over these 28 tags.
 */
export const TOUCH_TAG_SOURCE = "local-port:task-010" as const;

export const CLOSED_TOUCH_TAGS = [
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

export type TouchTag = (typeof CLOSED_TOUCH_TAGS)[number];

const TAG_INDEX = new Map<string, TouchTag>(CLOSED_TOUCH_TAGS.map((tag) => [tag, tag]));

/** Planned-tag aliases used in task prose. Emitted tags are always closed. */
const TAG_ALIASES: Readonly<Record<string, TouchTag>> = {
  ui: "interactive_ui",
  migrations: "migration",
  external_http: "external_api",
  pii: "personal_data",
};

export interface ScopePredicate {
  readonly any?: readonly TouchTag[];
  readonly all?: readonly TouchTag[];
}

export function isTouchTag(value: string): value is TouchTag {
  return TAG_INDEX.has(value);
}

export function normalizeTouchTag(value: string): TouchTag | null {
  const closed = TAG_INDEX.get(value);
  if (closed) return closed;
  return TAG_ALIASES[value] ?? null;
}

export function sortTouchTags(tags: Iterable<TouchTag>): TouchTag[] {
  const present = new Set(tags);
  return CLOSED_TOUCH_TAGS.filter((tag) => present.has(tag));
}

/**
 * A task matches when every `all` tag is present and, if `any` is non-empty,
 * at least one `any` tag is present. `global` matches every tag set.
 * Empty scopes are rejected by the catalog validator and do not match here.
 */
export function matchesScopePredicate(
  scope: ScopePredicate,
  tags: ReadonlySet<TouchTag>,
  global = false,
): boolean {
  if (global) return true;
  const anyTags = scope.any ?? [];
  const allTags = scope.all ?? [];
  if (anyTags.length === 0 && allTags.length === 0) return false;
  for (const tag of allTags) {
    if (!tags.has(tag)) return false;
  }
  if (anyTags.length === 0) return true;
  for (const tag of anyTags) {
    if (tags.has(tag)) return true;
  }
  return false;
}

export function touchTagSet(tags: readonly TouchTag[]): Set<TouchTag> {
  return new Set(tags);
}
