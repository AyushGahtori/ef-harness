import type { MatchableRule } from "./types.js";

function crossCutting(
  id: string,
  title: string,
  anyTags: readonly string[] | null,
  allTags: readonly string[] | null,
): MatchableRule {
  return {
    id,
    title,
    kind: "cross_cutting",
    active: true,
    global: false,
    any: anyTags,
    all: allTags,
    appliesAs: "must",
    checkIds: [`${id}-CHECK`],
  };
}

function universalPolicy(
  id: string,
  title: string,
  anyTags: readonly string[],
): MatchableRule {
  return {
    id,
    title,
    kind: "universal_policy",
    active: true,
    global: false,
    any: anyTags,
    all: null,
    appliesAs: "must",
    checkIds: [`${id}-CHECK`],
  };
}

/**
 * V1 corpus rules. A comma list is `any`. "with" is `all` (X-07).
 * "route with server handler" is the tags `route` and `authz`.
 */
export function corpusCrossCuttingRules(): readonly MatchableRule[] {
  return [
    crossCutting(
      "X-01",
      "Every server action and endpoint checks the caller's role",
      ["authz", "route"],
      null,
    ),
    crossCutting(
      "X-02",
      "Inputs are validated at the boundary with the shared schema",
      ["form_input", "inbound_webhook", "external_api"],
      null,
    ),
    crossCutting(
      "X-03",
      "Times are stored in UTC and shown in the project's display zone",
      ["scheduling", "time_display"],
      null,
    ),
    crossCutting("X-04", "Money uses integer minor units and one rounding rule", ["money"], null),
    crossCutting(
      "X-05",
      "Secrets come only from configuration, never code or logs",
      ["credentials", "config_env", "logging"],
      null,
    ),
    crossCutting(
      "X-06",
      "Destructive actions confirm and can be undone or audited",
      ["destructive_write"],
      null,
    ),
    crossCutting(
      "X-07",
      "Personal data is never written to logs",
      null,
      ["personal_data", "logging"],
    ),
    crossCutting(
      "X-08",
      "File uploads limit type and size and are stored outside public paths",
      ["file_upload"],
      null,
    ),
    crossCutting(
      "X-09",
      "Inbound webhooks verify signatures and are idempotent",
      ["inbound_webhook"],
      null,
    ),
    crossCutting(
      "X-10",
      "Outbound calls have timeouts and bounded retries",
      ["external_api", "outbound_message"],
      null,
    ),
    crossCutting(
      "X-11",
      "Errors use the shared error format and banner",
      ["route", "interactive_ui"],
      null,
    ),
    crossCutting(
      "X-12",
      "Background jobs are idempotent and safe to retry",
      ["background_job"],
      null,
    ),
    crossCutting(
      "X-13",
      "Interactive elements have accessible names and keyboard access",
      ["interactive_ui"],
      null,
    ),
    crossCutting(
      "X-14",
      "Sign-in and other abuse-prone endpoints are rate limited",
      ["authn", "rate_limited"],
      null,
    ),
    universalPolicy("UP-01", "Skeleton or spinner after 300 ms; no layout jump", ["interactive_ui"]),
    universalPolicy("UP-02", "Message naming what's missing and the action to add it", [
      "interactive_ui",
    ]),
    universalPolicy("UP-03", "Message, cause in plain words if known, Retry", [
      "interactive_ui",
      "route",
    ]),
    universalPolicy("UP-04", "Button disabled while submitting; success feedback", ["form_input"]),
    universalPolicy("UP-05", "Confirmation naming the item", ["destructive_write"]),
    universalPolicy("UP-06", "Paginate or virtualize above 100 items", ["interactive_ui"]),
    universalPolicy("UP-07", "Shown in the zone decided by `time.locale_timezone`", [
      "time_display",
    ]),
    universalPolicy("UP-08", "Not-found page with a way back", ["route"]),
  ];
}

export const CORPUS_RULE_IDS: readonly string[] = corpusCrossCuttingRules().map((rule) => rule.id);
