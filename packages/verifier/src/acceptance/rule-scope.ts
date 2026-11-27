import { asRecord, asStringArray, parseJsonOrNull } from "./sql.js";

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

export interface RuleScope {
  readonly any: readonly string[];
  readonly all: readonly string[];
}

/**
 * Corpus scopes. A list is `any`; "with" is `all`.
 * X-07 is `all: [personal_data, logging]`.
 * X-01's "route with server handler" is the tag pair `route` + `authz`.
 * A rule node's `fields.scope` overrides this table.
 */
export const BUILTIN_CROSS_CUTTING_SCOPES: Readonly<Record<CrossCuttingRuleId, RuleScope>> = {
  "X-01": { any: ["authz"], all: [] },
  "X-02": { any: ["form_input", "inbound_webhook", "external_api"], all: [] },
  "X-03": { any: ["scheduling", "time_display"], all: [] },
  "X-04": { any: ["money"], all: [] },
  "X-05": { any: ["credentials", "config_env", "logging"], all: [] },
  "X-06": { any: ["destructive_write"], all: [] },
  "X-07": { any: [], all: ["personal_data", "logging"] },
  "X-08": { any: ["file_upload"], all: [] },
  "X-09": { any: ["inbound_webhook"], all: [] },
  "X-10": { any: ["external_api", "outbound_message"], all: [] },
  "X-11": { any: ["route", "interactive_ui"], all: [] },
  "X-12": { any: ["background_job"], all: [] },
  "X-13": { any: ["interactive_ui"], all: [] },
  "X-14": { any: ["authn", "rate_limited"], all: [] },
};

export function scopeMatches(scope: RuleScope, tags: ReadonlySet<string>): boolean {
  if (scope.all.length === 0 && scope.any.length === 0) return false;
  if (scope.all.length > 0 && !scope.all.every((tag) => tags.has(tag))) return false;
  if (scope.any.length > 0 && !scope.any.some((tag) => tags.has(tag))) return false;
  return true;
}

export function isCrossCuttingRuleId(id: string): id is CrossCuttingRuleId {
  return Object.prototype.hasOwnProperty.call(BUILTIN_CROSS_CUTTING_SCOPES, id);
}

export function scopeFromFields(fields: unknown): RuleScope | null {
  const record = asRecord(fields);
  const scope = asRecord(record?.scope);
  if (!scope) return null;
  const any = asStringArray(scope.any);
  const all = asStringArray(scope.all);
  if (any.length === 0 && all.length === 0) return null;
  return { any, all };
}

export function resolveRuleScope(ruleId: string, fields: unknown): RuleScope | null {
  return scopeFromFields(fields) ?? (isCrossCuttingRuleId(ruleId) ? BUILTIN_CROSS_CUTTING_SCOPES[ruleId] : null);
}

export function checkIdsFromFields(fields: unknown): string[] {
  const record = asRecord(fields);
  return asStringArray(record?.check_ids);
}

export function parseNodeFields(text: string): unknown {
  return parseJsonOrNull(text);
}
