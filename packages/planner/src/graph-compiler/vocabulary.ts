export const CLOSED_TOUCHES_TAGS = [
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

export type TouchesTag = (typeof CLOSED_TOUCHES_TAGS)[number];

export const CLOSED_TOUCHES_TAG_SET: ReadonlySet<string> = new Set(CLOSED_TOUCHES_TAGS);

export interface CrossCuttingRule {
  readonly id: string;
  readonly any?: readonly TouchesTag[];
  readonly all?: readonly TouchesTag[];
}

export const CROSS_CUTTING_RULES: readonly CrossCuttingRule[] = [
  { id: "X-01", all: ["route", "authz"] },
  { id: "X-02", any: ["form_input", "inbound_webhook", "external_api"] },
  { id: "X-03", any: ["scheduling", "time_display"] },
  { id: "X-04", any: ["money"] },
  { id: "X-05", any: ["credentials", "config_env", "logging"] },
  { id: "X-06", any: ["destructive_write"] },
  { id: "X-07", all: ["personal_data", "logging"] },
  { id: "X-08", any: ["file_upload"] },
  { id: "X-09", any: ["inbound_webhook"] },
  { id: "X-10", any: ["external_api", "outbound_message"] },
  { id: "X-11", any: ["route", "interactive_ui"] },
  { id: "X-12", any: ["background_job"] },
  { id: "X-13", any: ["interactive_ui"] },
  { id: "X-14", any: ["authn", "rate_limited"] },
];

export const JUNIOR_MUST_TOKEN_CEILING = 3_000;
export const SENIOR_MUST_TOKEN_CEILING = 6_000;

export const NON_WAIVABLE_WAIVER_CODES = [
  "cycle_check",
  "parallel_write_overlap",
  "unresolved_contradiction",
  "missing_sealed_check",
  "missing_sealed_auth_check",
  "missing_sealed_payments_check",
  "missing_sealed_pii_check",
  "must_truncation",
  "oversized_must",
] as const;

export const WAIVABLE_SOFT_WARNING_CODES = ["generated_scaffold_file_count"] as const;

export const NON_WAIVABLE_WAIVER_CODE_SET: ReadonlySet<string> = new Set(NON_WAIVABLE_WAIVER_CODES);

export function ruleMatches(rule: CrossCuttingRule, tags: readonly string[]): boolean {
  const present = new Set(tags);
  if (rule.all !== undefined && rule.all.some((tag) => !present.has(tag))) return false;
  if (rule.any !== undefined && !rule.any.some((tag) => present.has(tag))) return false;
  return rule.any !== undefined || rule.all !== undefined;
}

export function matchedRuleIds(tags: readonly string[]): string[] {
  const ids: string[] = [];
  for (const rule of CROSS_CUTTING_RULES) {
    if (ruleMatches(rule, tags)) ids.push(rule.id);
  }
  return ids;
}
