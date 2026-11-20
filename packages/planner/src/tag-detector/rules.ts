import {
  CLOSED_TOUCH_TAGS,
  isTouchTag,
  matchesScopePredicate,
  type ScopePredicate,
  type TouchTag,
} from "./closed-tags.js";

export const EXPECTED_RULE_IDS = [
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

export type RuleId = (typeof EXPECTED_RULE_IDS)[number];

/** Topics the task text requires the 14 corpus rules to cover, collectively. */
export const COVERING_TOPICS = [
  "auth_authorization_on_every_protected_route",
  "tenant_id_scoping_on_every_multi_tenant_query",
  "pii_secret_redaction_in_logs_and_errors",
  "timezone_cutoff_consistency",
  "money_currency_integer_arithmetic",
  "idempotency_on_retried_mutations_and_webhooks",
  "optimistic_pessimistic_locking_on_shared_counters_and_inventory",
  "safe_file_upload_validation_and_non_executable_serving",
  "outbound_email_webhook_retry_and_dead_letter",
  "pagination_bounded_query_enforcement",
  "destructive_action_confirmation_and_audit_trail",
  "accessible_responsive_ui_and_design_token_compliance",
  "safe_sql_html_command_injection_boundaries",
  "graceful_degradation_and_timeout_budgets_on_external_calls",
] as const;

export type CoveringTopic = (typeof COVERING_TOPICS)[number];

const TOPIC_SET = new Set<string>(COVERING_TOPICS);

export const CORPUS_RULE_TITLES: Readonly<Record<RuleId, string>> = {
  "X-01": "Every server action and endpoint checks the caller's role",
  "X-02": "Inputs are validated at the boundary with the shared schema",
  "X-03": "Times are stored in UTC and shown in the project's display zone",
  "X-04": "Money uses integer minor units and one rounding rule",
  "X-05": "Secrets come only from configuration, never code or logs",
  "X-06": "Destructive actions confirm and can be undone or audited",
  "X-07": "Personal data is never written to logs",
  "X-08": "File uploads limit type and size and are stored outside public paths",
  "X-09": "Inbound webhooks verify signatures and are idempotent",
  "X-10": "Outbound calls have timeouts and bounded retries",
  "X-11": "Errors use the shared error format and banner",
  "X-12": "Background jobs are idempotent and safe to retry",
  "X-13": "Interactive elements have accessible names and keyboard access",
  "X-14": "Sign-in and other abuse-prone endpoints are rate limited",
};

export interface VerificationCheck {
  readonly id: string;
  readonly kind: string;
  readonly spec: string;
}

export interface RuleMatchCase {
  readonly polarity: "positive" | "negative";
  readonly tags: readonly TouchTag[];
}

export interface CrossCuttingRule {
  readonly id: RuleId;
  readonly title: string;
  readonly requirement: string;
  readonly scope: ScopePredicate;
  readonly global: boolean;
  readonly appliesAs: "must";
  readonly checkIds: readonly string[];
  readonly verificationCheck: VerificationCheck;
  readonly matchCases: readonly RuleMatchCase[];
  readonly covers: readonly CoveringTopic[];
}

export class CatalogValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(issues.join("\n"));
    this.name = "CatalogValidationError";
    this.issues = issues;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function push(issues: string[], message: string): void {
  issues.push(message);
}

function readString(value: unknown, label: string, issues: string[]): string {
  if (typeof value !== "string" || value.trim() === "") {
    push(issues, `${label} must be a non-empty string`);
    return "";
  }
  return value.trim();
}

function readStringArray(value: unknown, label: string, issues: string[]): string[] {
  if (!Array.isArray(value)) {
    push(issues, `${label} must be an array of strings`);
    return [];
  }
  const out: string[] = [];
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || item.trim() === "") {
      push(issues, `${label}[${index}] must be a non-empty string`);
      continue;
    }
    out.push(item.trim());
  }
  return out;
}

function readTouchTags(value: unknown, label: string, issues: string[]): TouchTag[] {
  const raw = readStringArray(value, label, issues);
  const tags: TouchTag[] = [];
  for (const tag of raw) {
    if (!isTouchTag(tag)) {
      push(
        issues,
        `${label} tag ${tag} is outside the closed ${CLOSED_TOUCH_TAGS.length} touches tags`,
      );
      continue;
    }
    tags.push(tag);
  }
  return tags;
}

export function readScope(value: unknown, label: string, issues: string[]): ScopePredicate {
  if (typeof value === "string") {
    push(issues, `${label} must be { any, all } over closed tags, not a string expression`);
    return {};
  }
  if (!isRecord(value)) {
    push(issues, `${label} must be an object with only any and/or all`);
    return {};
  }
  for (const key of Object.keys(value)) {
    if (key !== "any" && key !== "all") {
      push(issues, `${label}.${key} is not allowed; scope language is only any and all`);
    }
  }
  const scope: { any?: TouchTag[]; all?: TouchTag[] } = {};
  if ("any" in value) {
    if (Array.isArray(value.any)) {
      for (const item of value.any) {
        if (item !== null && typeof item === "object") {
          push(issues, `${label}.any rejects nested boolean expressions`);
        }
      }
    }
    scope.any = readTouchTags(value.any, `${label}.any`, issues);
  }
  if ("all" in value) {
    const allTags = readTouchTags(value.all, `${label}.all`, issues);
    if (Array.isArray(value.all)) {
      for (const item of value.all) {
        if (item !== null && typeof item === "object") {
          push(issues, `${label}.all rejects nested boolean expressions`);
        }
      }
    }
    scope.all = allTags;
  }
  return scope;
}

function scopeIsEmpty(scope: ScopePredicate): boolean {
  return (scope.any?.length ?? 0) === 0 && (scope.all?.length ?? 0) === 0;
}

function readMatchCases(value: unknown, label: string, issues: string[]): RuleMatchCase[] {
  if (!Array.isArray(value) || value.length === 0) {
    push(issues, `${label} must contain at least one match case`);
    return [];
  }
  const cases: RuleMatchCase[] = [];
  for (const [index, item] of value.entries()) {
    const caseLabel = `${label}[${index}]`;
    if (!isRecord(item)) {
      push(issues, `${caseLabel} must be an object`);
      continue;
    }
    const polarity = item.polarity;
    if (polarity !== "positive" && polarity !== "negative") {
      push(issues, `${caseLabel}.polarity must be positive or negative`);
      continue;
    }
    const tags = readTouchTags(item.tags, `${caseLabel}.tags`, issues);
    cases.push({ polarity, tags });
  }
  return cases;
}

const RULE_KEYS = new Set([
  "id",
  "title",
  "requirement",
  "scope",
  "global",
  "applies_as",
  "check_ids",
  "verification_check",
  "match_cases",
  "covers",
]);

function readVerificationCheck(value: unknown, label: string, issues: string[]): VerificationCheck {
  if (!isRecord(value)) {
    push(issues, `${label} must be an object with id, kind, and spec`);
    return { id: "", kind: "", spec: "" };
  }
  for (const key of Object.keys(value)) {
    if (key !== "id" && key !== "kind" && key !== "spec") {
      push(issues, `${label}.${key} is not a verification_check field`);
    }
  }
  return {
    id: readString(value.id, `${label}.id`, issues),
    kind: readString(value.kind, `${label}.kind`, issues),
    spec: readString(value.spec, `${label}.spec`, issues),
  };
}

function readCovers(value: unknown, label: string, issues: string[]): CoveringTopic[] {
  const raw = readStringArray(value, label, issues);
  const covers: CoveringTopic[] = [];
  for (const topic of raw) {
    if (!TOPIC_SET.has(topic)) {
      push(issues, `${label} topic ${topic} is not one of the 14 required covering topics`);
      continue;
    }
    covers.push(topic as CoveringTopic);
  }
  return covers;
}

export function parseCrossCuttingRule(value: unknown, index: number): {
  readonly rule: CrossCuttingRule | null;
  readonly issues: readonly string[];
} {
  const issues: string[] = [];
  const label = `rules[${index}]`;
  if (!isRecord(value)) {
    return { rule: null, issues: [`${label} must be an object`] };
  }
  for (const key of Object.keys(value)) {
    if (!RULE_KEYS.has(key)) {
      push(issues, `${label}.${key} is not allowed on a cross-cutting rule`);
    }
  }
  const id = readString(value.id, `${label}.id`, issues);
  if (id && !EXPECTED_RULE_IDS.includes(id as RuleId)) {
    push(issues, `${label}.id ${id} is outside X-01..X-14`);
  }
  const title = readString(value.title, `${label}.title`, issues);
  const requirement = readString(value.requirement, `${label}.requirement`, issues);
  const scope = readScope(value.scope, `${label}.scope`, issues);
  let globalFlag = false;
  if ("global" in value) {
    if (typeof value.global !== "boolean") {
      push(issues, `${label}.global must be a boolean`);
    } else {
      globalFlag = value.global;
    }
  }
  if (!globalFlag && scopeIsEmpty(scope)) {
    push(
      issues,
      `${label}.scope is empty; a rule that matches every task must set global: true`,
    );
  }
  const applies = readString(value.applies_as, `${label}.applies_as`, issues);
  if (applies && applies !== "must") {
    push(issues, `${label}.applies_as must be must`);
  }
  const checkIds = readStringArray(value.check_ids, `${label}.check_ids`, issues);
  if (checkIds.length === 0) {
    push(issues, `${label}.check_ids must list at least one check id`);
  }
  const verificationCheck = readVerificationCheck(
    value.verification_check,
    `${label}.verification_check`,
    issues,
  );
  if (verificationCheck.id && !checkIds.includes(verificationCheck.id)) {
    push(issues, `${label}.verification_check.id must be listed in check_ids`);
  }
  const matchCases = readMatchCases(value.match_cases, `${label}.match_cases`, issues);
  const covers = readCovers(value.covers, `${label}.covers`, issues);
  if (!id || !EXPECTED_RULE_IDS.includes(id as RuleId) || issues.length > 0) {
    return { rule: null, issues };
  }
  const ruleId = id as RuleId;
  const expectedTitle = CORPUS_RULE_TITLES[ruleId];
  if (title !== expectedTitle) {
    push(issues, `${label}.title must match the v1 corpus title for ${ruleId}`);
  }
  if (issues.length > 0) return { rule: null, issues };
  return {
    rule: {
      id: ruleId,
      title,
      requirement,
      scope,
      global: globalFlag,
      appliesAs: "must",
      checkIds,
      verificationCheck,
      matchCases,
      covers,
    },
    issues,
  };
}

export function parseCrossCuttingDocument(value: unknown): CrossCuttingRule[] {
  const issues: string[] = [];
  if (!isRecord(value)) {
    throw new CatalogValidationError(["cross-cutting rule document must be an object"]);
  }
  for (const key of Object.keys(value)) {
    if (key !== "version" && key !== "tags_closed" && key !== "rules") {
      push(issues, `unexpected document key ${key}`);
    }
  }
  if (value.version !== 1) {
    push(issues, "version must be 1");
  }
  if (value.tags_closed !== CLOSED_TOUCH_TAGS.length) {
    push(issues, `tags_closed must be ${CLOSED_TOUCH_TAGS.length}`);
  }
  if (!Array.isArray(value.rules)) {
    push(issues, "rules must be an array");
    throw new CatalogValidationError(issues);
  }
  if (value.rules.length !== EXPECTED_RULE_IDS.length) {
    push(issues, `expected exactly ${EXPECTED_RULE_IDS.length} rules, found ${value.rules.length}`);
  }
  const rules: CrossCuttingRule[] = [];
  for (const [index, item] of value.rules.entries()) {
    const parsed = parseCrossCuttingRule(item, index);
    issues.push(...parsed.issues);
    if (parsed.rule) rules.push(parsed.rule);
  }
  const ids = rules.map((rule) => rule.id);
  for (const [index, expected] of EXPECTED_RULE_IDS.entries()) {
    if (ids[index] !== expected) {
      push(issues, `rules[${index}].id must be ${expected}`);
    }
  }
  const covered = new Set<string>();
  for (const rule of rules) {
    for (const topic of rule.covers) covered.add(topic);
  }
  for (const topic of COVERING_TOPICS) {
    if (!covered.has(topic)) {
      push(issues, `covering topic ${topic} is missing from X-01..X-14`);
    }
  }
  if (issues.length > 0) throw new CatalogValidationError(issues);
  return rules;
}

export function ruleMatches(rule: CrossCuttingRule, tags: ReadonlySet<TouchTag>): boolean {
  return matchesScopePredicate(rule.scope, tags, rule.global);
}

export function matchingRuleIds(
  rules: readonly CrossCuttingRule[],
  tags: ReadonlySet<TouchTag>,
): RuleId[] {
  return rules.filter((rule) => ruleMatches(rule, tags)).map((rule) => rule.id);
}
