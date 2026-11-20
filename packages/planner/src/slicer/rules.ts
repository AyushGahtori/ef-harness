export interface ScopePredicate {
  readonly any?: readonly string[];
  readonly all?: readonly string[];
  readonly global?: boolean;
}

export interface RuleSpec {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly scopes: readonly ScopePredicate[];
}

export const RULE_CATALOG_SOURCE = "local-port:task-076-077" as const;

/**
 * Closed X-01..X-14 and UP-01..UP-08 scopes.
 * Informal `api` / `data` tags select only the API/data bundle
 * (X-01, X-02, UP-02, UP-03). `ui` and `payment` stay on the UI and money rules.
 */
export const RULE_CATALOG: readonly RuleSpec[] = [
  rule("X-01", "Every server action and endpoint checks the caller's role", "X-01 checks the caller role on every protected route.", [
    { all: ["route", "authz"] },
    { any: ["api"] },
  ]),
  rule("X-02", "Inputs are validated at the boundary with the shared schema", "X-02 validates boundary input and bounds every list query.", [
    { any: ["form_input", "inbound_webhook", "external_api", "search", "api", "data"] },
  ]),
  rule("X-03", "Times are stored in UTC and shown in the project's display zone", "X-03 stores times in UTC and shows the project display zone.", [
    { any: ["scheduling", "time_display"] },
  ]),
  rule("X-04", "Money uses integer minor units and one rounding rule", "X-04 uses integer minor units for money and payment amounts.", [
    { any: ["money", "payment"] },
  ]),
  rule("X-05", "Secrets come only from configuration, never code or logs", "X-05 loads secrets from configuration and redacts them from logs.", [
    { any: ["credentials", "config_env", "logging"] },
  ]),
  rule("X-06", "Destructive actions confirm and can be undone or audited", "X-06 confirms each destructive action and keeps an undo or audit trail.", [
    { any: ["destructive_write"] },
  ]),
  rule("X-07", "Personal data is never written to logs", "X-07 never writes personal data to logs.", [
    { all: ["personal_data", "logging"] },
  ]),
  rule("X-08", "File uploads limit type and size and are stored outside public paths", "X-08 limits upload type and size and stores files outside public paths.", [
    { any: ["file_upload"] },
  ]),
  rule("X-09", "Inbound webhooks verify signatures and are idempotent", "X-09 verifies inbound webhook signatures and stays idempotent.", [
    { any: ["inbound_webhook"] },
  ]),
  rule("X-10", "Outbound calls have timeouts and bounded retries", "X-10 bounds outbound calls with a timeout and limited retries.", [
    { any: ["external_api", "outbound_message"] },
  ]),
  rule("X-11", "Errors use the shared error format and banner", "X-11 uses the shared error format and the same error banner.", [
    { any: ["route", "interactive_ui", "ui"] },
  ]),
  rule("X-12", "Background jobs are idempotent and safe to retry", "X-12 keeps background jobs idempotent under retry.", [
    { any: ["background_job", "concurrent_edit"] },
  ]),
  rule("X-13", "Interactive elements have accessible names and keyboard access", "X-13 gives interactive elements accessible names and keyboard access.", [
    { any: ["interactive_ui", "ui", "web", "print", "web_frontend"] },
  ]),
  rule("X-14", "Sign-in and other abuse-prone endpoints are rate limited", "X-14 rate limits sign-in and other abuse-prone endpoints.", [
    { any: ["authn", "rate_limited"] },
  ]),
  rule("UP-01", "Secret and credential hygiene", "UP-01 loads secrets from the environment or a vault and never logs them.", [
    { any: ["credentials", "config_env", "logging"] },
  ]),
  rule("UP-02", "Server-side input validation", "UP-02 validates inputs on the server against the canonical schema.", [
    { any: ["form_input", "inbound_webhook", "external_api", "route", "data"] },
  ]),
  rule("UP-03", "Structured user-safe errors", "UP-03 returns structured user-safe errors with no stack in the body.", [
    { any: ["route", "interactive_ui", "logging", "api"] },
  ]),
  rule("UP-04", "Authorized idempotent mutations", "UP-04 authorizes mutations and confirms destructive actions by name.", [
    { any: ["destructive_write", "authz", "route"] },
  ]),
  rule("UP-05", "UTC storage and integer money", "UP-05 stores UTC instants and integer minor units.", [
    { any: ["time_display", "scheduling", "money", "payment"] },
  ]),
  rule("UP-06", "Page, upload, and timeout ceilings", "UP-06 enforces the page, upload, and timeout ceilings.", [
    { any: ["search", "file_upload", "route", "rate_limited"] },
  ]),
  rule("UP-07", "Accessible interactive UI", "UP-07 requires accessible names, keyboard focus, and contrast.", [
    { any: ["interactive_ui", "form_input", "ui", "web", "print", "web_frontend"] },
  ]),
  rule("UP-08", "Structured logs and health", "UP-08 writes structured logs with a request id and a health endpoint.", [
    { any: ["logging", "route", "background_job"] },
  ]),
];

function rule(id: string, title: string, text: string, scopes: readonly ScopePredicate[]): RuleSpec {
  return { id, title, text, scopes };
}

export function ruleMatches(ruleSpec: RuleSpec, tags: ReadonlySet<string>): boolean {
  return ruleSpec.scopes.some((scope) => scopeMatches(scope, tags));
}

export function scopeMatches(scope: ScopePredicate, tags: ReadonlySet<string>): boolean {
  if (scope.global) return true;
  const all = scope.all ?? [];
  const any = scope.any ?? [];
  if (all.length === 0 && any.length === 0) return false;
  for (const tag of all) {
    if (!tags.has(tag)) return false;
  }
  if (any.length === 0) return true;
  return any.some((tag) => tags.has(tag));
}

export function matchingRules(tags: readonly string[], catalog: readonly RuleSpec[] = RULE_CATALOG): RuleSpec[] {
  const set = new Set(tags);
  return catalog.filter((entry) => ruleMatches(entry, set));
}
