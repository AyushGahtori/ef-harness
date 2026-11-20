import { describe, expect, it } from "vitest";
import { DiffAutoTagDetector } from "../../src/tag-detector/diff-tag-detector.js";
import { EntityTagInheritor } from "../../src/tag-detector/entity-tag-inheritor.js";
import { StaticRuleLintGate } from "../../src/tag-detector/lint.js";
import {
  injectNumericDefaultClash,
  injectPrototypeAuthPreferenceClash,
  M2_QUESTION_IDS,
  m2StagePort,
} from "../../src/tag-detector/m2-stage-port.js";
import { SeamTaskAutoMatcher } from "../../src/tag-detector/seam-match.js";
import { StageCoherenceSelfTest } from "../../src/tag-detector/stage-coherence.js";
import { RulesSeamsCatalogLoader } from "../../src/tag-detector/catalog.js";
import { CLOSED_TOUCH_TAGS, matchesScopePredicate, touchTagSet } from "../../src/tag-detector/closed-tags.js";
import { parseCrossCuttingRule } from "../../src/tag-detector/rules.js";
import { CORPUS_RULE_TITLES, COVERING_TOPICS } from "../../src/tag-detector/rules.js";
import type { CrossCuttingRule } from "../../src/tag-detector/rules.js";
import type { SeamParty } from "../../src/tag-detector/seam-match.js";

function unified(filePath: string, lines: readonly string[]): string {
  const body = lines.map((line) => `+${line}`).join("\n");
  return [
    `diff --git a/${filePath} b/${filePath}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${filePath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    body,
  ].join("\n");
}

function party(partial: Partial<SeamParty> & Pick<SeamParty, "id">): SeamParty {
  return {
    kind: "task",
    tags: [],
    entities: [],
    endpoints: [],
    events: [],
    ...partial,
  };
}

describe("rules and seams catalog", () => {
  const catalog = new RulesSeamsCatalogLoader().load();

  it("loads exactly X-01 through X-14 and S-01 through S-10", () => {
    expect(catalog.rules.map((rule) => rule.id)).toEqual([
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
    ]);
    expect(catalog.seams.map((seam) => seam.id)).toEqual([
      "S-01",
      "S-02",
      "S-03",
      "S-04",
      "S-05",
      "S-06",
      "S-07",
      "S-08",
      "S-09",
      "S-10",
    ]);
    expect(CLOSED_TOUCH_TAGS).toHaveLength(28);
    expect(new StaticRuleLintGate().lintRules(catalog.rules, { inventory: true }).ok).toBe(true);
    expect(new StaticRuleLintGate().lintSeams(catalog.seams, { inventory: true }).ok).toBe(true);
  });

  it("keeps corpus titles and covers every required topic", () => {
    for (const rule of catalog.rules) {
      expect(rule.title).toBe(CORPUS_RULE_TITLES[rule.id]);
      expect(rule.global).toBe(false);
    }
    const covered = new Set(catalog.rules.flatMap((rule) => rule.covers));
    expect([...covered].sort()).toEqual([...COVERING_TOPICS].sort());
  });

  it("matches X-01 only when route and authz are both present", () => {
    const rule = catalog.rules.find((item) => item.id === "X-01");
    expect(rule).toBeDefined();
    if (!rule) return;
    expect(matchesScopePredicate(rule.scope, touchTagSet(["route", "authz"]))).toBe(true);
    expect(matchesScopePredicate(rule.scope, touchTagSet(["route"]))).toBe(false);
    expect(matchesScopePredicate(rule.scope, touchTagSet(["personal_data", "logging"]))).toBe(false);
  });

  it("matches X-07 only when personal data and logging are both present", () => {
    const rule = catalog.rules.find((item) => item.id === "X-07");
    expect(rule).toBeDefined();
    if (!rule) return;
    expect(matchesScopePredicate(rule.scope, touchTagSet(["personal_data", "logging"]))).toBe(true);
    expect(matchesScopePredicate(rule.scope, touchTagSet(["personal_data"]))).toBe(false);
  });

  it("rejects an empty scope unless global is set", () => {
    const parsed = parseCrossCuttingRule(
      {
        id: "X-01",
        title: CORPUS_RULE_TITLES["X-01"],
        requirement: "Authorize every protected route.",
        scope: { any: [], all: [] },
        global: false,
        applies_as: "must",
        check_ids: ["X01-ROLE-TENANT"],
        verification_check: {
          id: "X01-ROLE-TENANT",
          kind: "generated_negative_test",
          spec: "Denied roles receive 403.",
        },
        match_cases: [
          { polarity: "positive", tags: ["route", "authz"] },
          { polarity: "negative", tags: ["route"] },
        ],
        covers: ["auth_authorization_on_every_protected_route"],
      },
      0,
    );
    expect(parsed.issues.join("\n")).toMatch(/empty/);
    const globalRule = parseCrossCuttingRule(
      {
        id: "X-01",
        title: CORPUS_RULE_TITLES["X-01"],
        requirement: "Authorize every protected route.",
        scope: {},
        global: true,
        applies_as: "must",
        check_ids: ["X01-ROLE-TENANT"],
        verification_check: {
          id: "X01-ROLE-TENANT",
          kind: "generated_negative_test",
          spec: "Denied roles receive 403.",
        },
        match_cases: [{ polarity: "positive", tags: ["route", "authz"] }],
        covers: ["auth_authorization_on_every_protected_route"],
      },
      0,
    );
    expect(globalRule.issues.join("\n")).not.toMatch(/empty/);
    expect(globalRule.rule?.global).toBe(true);
  });

  it("rejects regex scopes, unknown tags, and nested expressions", () => {
    const regex = parseCrossCuttingRule(
      {
        id: "X-04",
        title: CORPUS_RULE_TITLES["X-04"],
        requirement: "Use integer minor units.",
        scope: { any: ["money"], pattern: ".*" },
        global: false,
        applies_as: "must",
        check_ids: ["X04-MINOR-UNITS"],
        verification_check: { id: "X04-MINOR-UNITS", kind: "property_test", spec: "Exact minor units." },
        match_cases: [
          { polarity: "positive", tags: ["money"] },
          { polarity: "negative", tags: ["route"] },
        ],
        covers: ["money_currency_integer_arithmetic"],
      },
      0,
    );
    expect(regex.issues.join("\n")).toMatch(/only any and all/);
    const unknown = parseCrossCuttingRule(
      {
        id: "X-04",
        title: CORPUS_RULE_TITLES["X-04"],
        requirement: "Use integer minor units.",
        scope: { any: ["payments_stripe"] },
        global: false,
        applies_as: "must",
        check_ids: ["X04-MINOR-UNITS"],
        verification_check: { id: "X04-MINOR-UNITS", kind: "property_test", spec: "Exact minor units." },
        match_cases: [
          { polarity: "positive", tags: ["money"] },
          { polarity: "negative", tags: ["route"] },
        ],
        covers: ["money_currency_integer_arithmetic"],
      },
      0,
    );
    expect(unknown.issues.join("\n")).toMatch(/payments_stripe/);
    const nested = parseCrossCuttingRule(
      {
        id: "X-04",
        title: CORPUS_RULE_TITLES["X-04"],
        requirement: "Use integer minor units.",
        scope: { any: [{ all: ["money"] }] },
        global: false,
        applies_as: "must",
        check_ids: ["X04-MINOR-UNITS"],
        verification_check: { id: "X04-MINOR-UNITS", kind: "property_test", spec: "Exact minor units." },
        match_cases: [
          { polarity: "positive", tags: ["money"] },
          { polarity: "negative", tags: ["route"] },
        ],
        covers: ["money_currency_integer_arithmetic"],
      },
      0,
    );
    expect(nested.issues.join("\n")).toMatch(/nested/);
  });

  it("rejects a 500-token requirement", () => {
    const bloated: CrossCuttingRule[] = catalog.rules.map((rule) =>
      rule.id === "X-04"
        ? { ...rule, requirement: Array.from({ length: 500 }, () => "bound").join(" ") }
        : rule,
    );
    const report = new StaticRuleLintGate().lintRules(bloated, { inventory: true });
    expect(report.ok).toBe(false);
    expect(report.violations.join("\n")).toMatch(/500 tokens/);
    expect(report.violations.join("\n")).toMatch(/ceiling is 120/);
  });
});

describe("DiffAutoTagDetector", () => {
  const detector = new DiffAutoTagDetector();

  it("tags migrations, auth, payments, uploads, cron, forms, and external http", () => {
    const diff = [
      unified("db/migrations/004_orders.sql", ["ALTER TABLE orders ADD COLUMN note TEXT;"]),
      unified("src/routes/orders.ts", [
        'import { requireAuth } from "../auth/middleware";',
        "export function postOrder() { return requireAuth(); }",
      ]),
      unified("src/billing/client.ts", ['import Stripe from "stripe";', "export const stripe = Stripe;"]),
      unified("src/lib/upload.ts", ['import multer from "multer";', "export const upload = multer();"]),
      unified("src/lib/schedule.ts", [
        'import cron from "node-cron";',
        'cron.schedule("0 * * * *", () => undefined);',
      ]),
      unified("src/ui/OrderForm.tsx", [
        "export function OrderForm() { return <form onSubmit={save}><input name=\"title\" /></form>; }",
      ]),
      unified("src/lib/notify.ts", [
        'export async function ping() { await fetch("https://hooks.example.com/webhook"); }',
      ]),
    ].join("\n");
    const report = detector.detect(diff);
    expect(report.tags).toEqual(
      expect.arrayContaining([
        "migration",
        "authn",
        "authz",
        "money",
        "file_upload",
        "scheduling",
        "background_job",
        "form_input",
        "interactive_ui",
        "external_api",
        "route",
      ]),
    );
  });

  it("ignores comments and test fixtures that mention password or stripe", () => {
    const diff = [
      unified("src/lib/format.ts", [
        "// password",
        '// import Stripe from "stripe"',
        "export function formatCount(value: number): string { return String(value); }",
      ]),
      unified("tests/fixtures/billing.fixture.ts", [
        'export const label = "password stripe";',
        'import Stripe from "stripe";',
      ]),
    ].join("\n");
    const report = detector.detect(diff);
    expect(report.tags).toEqual([]);
  });

  it("warns when a ui task diff adds a migration and an external webhook fetch", () => {
    const diff = [
      unified("db/migrations/004_orders.sql", ["CREATE TABLE orders (id TEXT PRIMARY KEY);"]),
      unified("src/lib/notify.ts", [
        'export async function ping() { await fetch("https://hooks.example.com/webhook"); }',
      ]),
    ].join("\n");
    const report = detector.detect(diff, { plannedTags: ["ui"] });
    expect(report.signals.some((signal) => signal.informal === "migrations" && signal.tag === "migration")).toBe(
      true,
    );
    expect(
      report.signals.some((signal) => signal.informal === "external_http" && signal.tag === "external_api"),
    ).toBe(true);
    expect(report.scopeCreep?.unexpectedTags).toEqual(expect.arrayContaining(["migration", "external_api"]));
    expect(report.scopeCreep?.extraRuleIds).toEqual(expect.arrayContaining(["X-02", "X-10"]));
    expect(report.scopeCreep?.warning).toMatch(/Scope creep/);
    expect(report.scopeCreep?.warning).toMatch(/migrations/);
    expect(report.scopeCreep?.warning).toMatch(/external_http/);
  });

  it("does not warn when the diff stays inside the planned ui tag", () => {
    const report = detector.detect(
      unified("src/ui/button.module.css", ["button { color: var(--accent); }"]),
      { plannedTags: ["ui"] },
    );
    expect(report.tags).toEqual(["interactive_ui"]);
    expect(report.scopeCreep).toBeNull();
  });
});

describe("EntityTagInheritor", () => {
  const inheritor = new EntityTagInheritor();

  it("adds pii to an export task and injects personal-data redaction", () => {
    const report = inheritor.inherit({
      nodes: [
        { id: "entity:Customer", kind: "entity", title: "Customer", tags: ["pii"] },
        { id: "T-Export", kind: "task", title: "Export customers to CSV", tags: [] },
      ],
      links: [{ type: "writes", from: "T-Export", to: "entity:Customer" }],
    });
    const task = report.nodes.find((node) => node.id === "T-Export");
    expect(task?.inheritedTags).toContain("pii");
    expect(task?.effectiveTags).toContain("pii");
    expect(task?.effectiveTags).toContain("personal_data");
    expect(task?.packetRuleIds).toContain("X-07");
    const rules = new RulesSeamsCatalogLoader().loadRules();
    const injected = rules.find((rule) => rule.id === "X-07");
    expect(injected?.covers).toContain("pii_secret_redaction_in_logs_and_errors");
  });

  it("propagates money, pii, and multi_tenant onto linked tasks, endpoints, and screens", () => {
    const report = inheritor.inherit({
      nodes: [
        {
          id: "entity:Order",
          kind: "entity",
          title: "Order",
          tags: ["money", "pii", "multi_tenant"],
        },
        { id: "T-Charge", kind: "task", title: "Charge order", tags: [] },
        { id: "endpoint:checkout", kind: "endpoint", title: "POST /checkout", tags: [] },
        { id: "screen:checkout", kind: "screen", title: "Checkout", tags: [] },
        { id: "feature:billing", kind: "feature", title: "Billing", tags: [] },
      ],
      links: [
        { type: "writes", from: "T-Charge", to: "entity:Order" },
        { type: "touches", from: "endpoint:checkout", to: "entity:Order" },
        { type: "reads", from: "screen:checkout", to: "endpoint:checkout" },
        { type: "belongs_to", from: "feature:billing", to: "entity:Order" },
      ],
    });
    for (const id of ["T-Charge", "endpoint:checkout", "screen:checkout"]) {
      const node = report.nodes.find((item) => item.id === id);
      expect(node?.effectiveTags).toEqual(expect.arrayContaining(["money", "pii", "multi_tenant"]));
      expect(node?.packetRuleIds).toEqual(expect.arrayContaining(["X-01", "X-04", "X-07"]));
    }
    const feature = report.nodes.find((node) => node.id === "feature:billing");
    expect(feature?.inheritedTags).toEqual([]);
    expect(feature?.packetRuleIds).toEqual([]);
  });
});

describe("SeamTaskAutoMatcher", () => {
  const matcher = new SeamTaskAutoMatcher(new RulesSeamsCatalogLoader().loadSeams());

  it("proposes the cache seam only when caching is touched", () => {
    const cached = matcher.match({
      left: party({ id: "T-Read", kind: "task", tags: ["caching"], entities: ["Order"] }),
      right: party({ id: "F-Store", kind: "feature", tags: [], entities: ["Order"] }),
    });
    expect(cached.map((item) => item.seamId)).toContain("S-09");

    const sqlite = matcher.match({
      left: party({ id: "T-Write", kind: "task", tags: ["migration"], entities: ["Order"] }),
      right: party({ id: "F-Db", kind: "feature", tags: ["destructive_write"], entities: ["Order"] }),
    });
    expect(sqlite.map((item) => item.seamId)).toContain("S-03");
    expect(sqlite.map((item) => item.seamId)).not.toContain("S-09");
  });

  it("proposes the auth seam when a protected route is shared", () => {
    const proposals = matcher.match({
      left: party({
        id: "T-Auth",
        tags: ["route", "authz"],
        endpoints: ["POST /orders"],
      }),
      right: party({
        id: "F-Api",
        kind: "feature",
        tags: ["session"],
        endpoints: ["POST /orders"],
      }),
    });
    expect(proposals.map((item) => item.seamId)).toContain("S-01");
  });

  it("returns no seam when the two sides share no entity, endpoint, or event", () => {
    const proposals = matcher.match({
      left: party({ id: "T-A", tags: ["caching"], entities: ["Order"] }),
      right: party({ id: "T-B", tags: ["caching"], entities: ["Invoice"] }),
    });
    expect(proposals).toEqual([]);
  });
});

describe("StageCoherenceSelfTest", () => {
  it("passes Prototype, MVP, and Production on the 44-question port", () => {
    const report = new StageCoherenceSelfTest(m2StagePort()).run();
    expect(M2_QUESTION_IDS).toHaveLength(44);
    expect(report.ok).toBe(true);
    for (const preset of report.presets) {
      expect(preset.selections).toHaveLength(44);
      expect(preset.conflicts).toEqual([]);
      expect(preset.unsatisfiedRequires).toEqual([]);
      expect(preset.numericConflicts).toEqual([]);
    }
  });

  it("fails when Prototype recommends No auth and Per-user saved preferences", () => {
    const report = new StageCoherenceSelfTest(
      injectPrototypeAuthPreferenceClash(m2StagePort()),
    ).run();
    expect(report.ok).toBe(false);
    const prototype = report.presets.find((preset) => preset.preset === "Prototype");
    expect(prototype?.conflicts.length).toBeGreaterThan(0);
    expect(prototype?.unsatisfiedRequires.length).toBeGreaterThan(0);
    const labels = prototype?.selections.map((selection) => selection.label) ?? [];
    expect(labels).toContain("No auth");
    expect(labels).toContain("Per-user saved preferences");
  });

  it("fails when recommended elaborations disagree on a numeric default", () => {
    const report = new StageCoherenceSelfTest(injectNumericDefaultClash(m2StagePort())).run();
    expect(report.ok).toBe(false);
    const prototype = report.presets.find((preset) => preset.preset === "Prototype");
    expect(prototype?.numericConflicts.some((conflict) => conflict.cell === "retention.days")).toBe(true);
  });
});
