import { describe, expect, it } from "vitest";
import { MergeBatchBisector } from "../../src/merge-queue/bisector.js";
import { verifyFeatureDoneConditions } from "../../src/merge-queue/done-gate.js";
import { ProjectIntegratorEngine } from "../../src/merge-queue/engine.js";
import { lintMigrations } from "../../src/merge-queue/migrations.js";
import { parseProjectIntegratorV1 } from "../../src/merge-queue/schema.js";
import { assertNoTestWeakening } from "../../src/merge-queue/test-weakening.js";
import type {
  DoneSnapshot,
  FeatureDoneEvidenceInput,
  MergeFeatureRequest,
  QueuedFeature,
} from "../../src/merge-queue/types.js";

const INTEGRATION_REF = "refs/heads/harness/integration";

function snapshot(overrides: Partial<DoneSnapshot> = {}): DoneSnapshot {
  return {
    tasks: [
      {
        id: "T1",
        state: "MERGED_TO_FEATURE",
        briefVersion: 2,
        acceptedBriefVersion: 2,
        contracts: [{ id: "C1", pin: 3, currentVersion: 3 }],
      },
    ],
    requirements: [{ id: "R1", kind: "spec_item", status: "passing" }],
    scopes: ["features/F1/"],
    checks: [
      { id: "S1", gate: "static_audit", version: 1, status: "pass" },
      { id: "J1", gate: "feature_journey", version: 1, status: "pass" },
      { id: "B1", gate: "sealed_step_3b", version: 1, status: "pass" },
    ],
    screenBearing: false,
    openCcrIds: [],
    earlierDoneFeatureIds: [],
    ...overrides,
  };
}

function evidence(overrides: Partial<FeatureDoneEvidenceInput> = {}): FeatureDoneEvidenceInput {
  return {
    feature: "F1",
    staticAudit: { clean: true, integratorCommitsIncluded: true, paths: ["features/F1/"] },
    journey: { passed: true, entryPoint: "/f1", cleanEnvironment: true },
    integrationMerge: {
      ref: INTEGRATION_REF,
      mergeCommit: "abc123",
      earlierDoneRegressionGreen: true,
      regressedFeatureIds: [],
    },
    accessibility: { seriousFindingIds: [] },
    ...overrides,
  };
}

function queued(id: string): QueuedFeature {
  const request = {
    featureId: id,
    featureRef: `refs/heads/harness/f/${id}`,
    spec: { id, title: id, text: id, contracts: [] },
    snapshot: snapshot(),
    taskIds: [id],
    requirementIds: [id],
    checkIds: [id],
    journeyEntryPoint: `/${id}`,
    staticAuditPaths: [`features/${id}/`],
  } satisfies MergeFeatureRequest;
  return {
    id,
    featureId: id,
    featureRef: request.featureRef,
    priority: 0,
    sequence: 1,
    status: "QUEUED",
    phase: "queued",
    evictionCount: 0,
    failureTrace: "",
    request,
    mergeSha: "",
  };
}

describe("feature DONE conditions", () => {
  it("accepts a snapshot that satisfies all seven conditions together", () => {
    const result = verifyFeatureDoneConditions(evidence(), snapshot());
    expect(result.ok).toBe(true);
    expect(result.failedConditions).toEqual([]);
  });

  it("refuses each of the seven conditions on its own", () => {
    const cases: { id: string; evidence: FeatureDoneEvidenceInput; snapshot: DoneSnapshot }[] = [
      { id: "1", evidence: evidence(), snapshot: snapshot({ tasks: [] }) },
      {
        id: "2",
        evidence: evidence(),
        snapshot: snapshot({ requirements: [{ id: "R1", kind: "spec_item", status: "fail" }] }),
      },
      {
        id: "3",
        evidence: evidence({ staticAudit: { clean: false, integratorCommitsIncluded: true, paths: ["features/F1/"] } }),
        snapshot: snapshot(),
      },
      {
        id: "4",
        evidence: evidence({ journey: { passed: false, entryPoint: "/f1", cleanEnvironment: true } }),
        snapshot: snapshot(),
      },
      {
        id: "5",
        evidence: evidence({
          integrationMerge: {
            ref: INTEGRATION_REF,
            mergeCommit: "abc123",
            earlierDoneRegressionGreen: true,
            regressedFeatureIds: [],
          },
        }),
        snapshot: snapshot({ earlierDoneFeatureIds: ["F-Earlier"] }),
      },
      {
        id: "6",
        evidence: evidence({ accessibility: { seriousFindingIds: ["axe-1"] } }),
        snapshot: snapshot({ screenBearing: true }),
      },
      { id: "7", evidence: evidence(), snapshot: snapshot({ openCcrIds: ["CCR-1"] }) },
    ];
    for (const item of cases) {
      const result = verifyFeatureDoneConditions(item.evidence, item.snapshot);
      expect(result.ok, `condition ${item.id}`).toBe(false);
      expect(result.failedConditions, `condition ${item.id}`).toContain(item.id);
    }
  });
});

describe("project-integrator@1 guards", () => {
  it("parses the success object and rejects extra keys and illegal decisions", () => {
    expect(
      parseProjectIntegratorV1({
        migrations_order: ["migrations/a.sql"],
        ccr_decisions: [{ id: "CCR-1", class: "additive", decision: "approve" }],
        rerun_suites: ["journey"],
      }),
    ).toMatchObject({ migrations_order: ["migrations/a.sql"] });
    expect(() =>
      parseProjectIntegratorV1({
        migrations_order: [],
        ccr_decisions: [],
        rerun_suites: [],
        extra: true,
      }),
    ).toThrow(/unexpected key/);
    expect(() =>
      parseProjectIntegratorV1({
        migrations_order: [],
        ccr_decisions: [{ id: "CCR-2", class: "breaking", decision: "approve" }],
        rerun_suites: [],
      }),
    ).toThrow(/breaking/);
    expect(parseProjectIntegratorV1({ blocked: true, reason: "contract clash" })).toMatchObject({
      blocked: true,
      reason: "contract clash",
    });
  });

  it("rejects a candidate that skips a passing test or drops the other side of a conflict", async () => {
    expect(() =>
      assertNoTestWeakening(
        [{ path: "features/F1/journey.test.mjs", text: "expect(true).toBe(true);\n" }],
        [{ path: "features/F1/journey.test.mjs", text: "describe.skip('silenced', () => {});\n" }],
      ),
    ).toThrow(/test_weakening|skip/);
    const engine = new ProjectIntegratorEngine(() => ({
      output: { migrations_order: [], ccr_decisions: [], rerun_suites: [] },
      files: [{ path: "shared/nav.txt", text: "home\nmenu\n" }],
    }));
    const conflict = "home\n<<<<<<< HEAD\nmenu\n=======\norders\n>>>>>>> feature\n";
    const dropped = await engine.resolve({
      attempt: 1,
      featureIds: ["F-Menu", "F-Orders"],
      conflicts: [
        {
          path: "shared/nav.txt",
          ours: ["menu"],
          theirs: ["orders"],
          contextBefore: ["home"],
          contextAfter: [],
        },
      ],
      specs: [
        { id: "F-Menu", title: "Menu", text: "Menu spec", contracts: [] },
        { id: "F-Orders", title: "Orders", text: "Orders spec", contracts: [] },
      ],
      migrationAst: "",
      migrationIssues: [],
      failingChecks: [],
      offendingCommits: [],
      worktree: "worktree",
      beforeFiles: [{ path: "shared/nav.txt", text: conflict }],
      conflictOriginals: [{ path: "shared/nav.txt", text: conflict }],
    });
    expect(dropped.ok).toBe(false);
    expect(dropped.reason).toBe("dropped_side");
    expect(dropped.prompt).toContain("Menu spec");
    expect(dropped.prompt).toContain("Orders spec");
    expect(dropped.prompt).not.toContain("SENTINEL_NOT_FOR_MODEL");
  });

  it("keeps both conflict sides without rewriting feature manifests", async () => {
    const engine = new ProjectIntegratorEngine();
    const conflict = "home\n<<<<<<< HEAD\nmenu\n=======\norders\n>>>>>>> feature\n";
    const manifest = `${JSON.stringify({ id: "F-Orders", routes: ["/settings"], shortcuts: ["Ctrl+K"], middleware: [{ name: "auth", order: 2 }] }, null, 2)}\n`;
    const resolved = await engine.resolve({
      attempt: 1,
      featureIds: ["F-Menu", "F-Orders"],
      conflicts: [
        {
          path: "shared/nav.txt",
          ours: ["menu"],
          theirs: ["orders"],
          contextBefore: ["home"],
          contextAfter: [],
        },
      ],
      specs: [
        { id: "F-Menu", title: "Menu", text: "Menu spec", contracts: [] },
        { id: "F-Orders", title: "Orders", text: "Orders spec", contracts: [] },
      ],
      migrationAst: "migrations/0001_menu.sql create_table menu",
      migrationIssues: [],
      failingChecks: [
        { id: "combined:duplicate-route:/settings", owners: ["F-Menu", "F-Orders"], trace: "duplicate route /settings", step: "journey" },
        { id: "combined:duplicate-shortcut:Ctrl+K", owners: ["F-Menu", "F-Orders"], trace: "duplicate shortcut Ctrl+K", step: "journey" },
        { id: "combined:middleware-order:auth", owners: ["F-Menu", "F-Orders"], trace: "conflicting middleware order for auth", step: "journey" },
      ],
      offendingCommits: [{ featureId: "F-Orders", sha: "bbbb", subject: "feature F-Orders" }],
      worktree: "worktree",
      beforeFiles: [
        { path: "shared/nav.txt", text: conflict },
        { path: "features/F-Orders/manifest.json", text: manifest },
        { path: "features/F-Orders/journey.test.mjs", text: "expect(true).toBe(true);\n" },
        { path: "notes/sentinel.txt", text: "SENTINEL_NOT_FOR_MODEL\n" },
      ],
      conflictOriginals: [{ path: "shared/nav.txt", text: conflict }],
    });
    expect(resolved.ok).toBe(true);
    const nav = resolved.files.find((file) => file.path === "shared/nav.txt")?.text ?? "";
    expect(nav).toContain("menu");
    expect(nav).toContain("orders");
    expect(resolved.files.some((file) => file.path.endsWith("manifest.json"))).toBe(false);
    expect(resolved.prompt).not.toContain("SENTINEL_NOT_FOR_MODEL");
    expect(resolved.prompt).toContain("bbbb");
  });

  it("flags sequential migration prefixes and foreign keys that apply too early", () => {
    const issues = lintMigrations([
      { file: "migrations/0001_orders.sql", sql: "CREATE TABLE orders (id TEXT PRIMARY KEY, menu_id TEXT REFERENCES menu(id));" },
      { file: "migrations/0001_menu.sql", sql: "CREATE TABLE menu (id TEXT PRIMARY KEY);" },
    ]);
    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["sequence_collision", "fk_order"]));
  });
});

describe("MergeBatchBisector", () => {
  it("lands the innocent features around one bad feature in a batch of three", async () => {
    const features = [queued("F1"), queued("F2"), queued("F3")];
    const landed: string[][] = [];
    const evicted: string[] = [];
    const bisector = new MergeBatchBisector({
      probe: async (subset) => {
        const bad = subset.some((feature) => feature.featureId === "F2");
        return {
          ok: !bad,
          trace: bad ? "F2 failed journey" : "",
          failingChecks: bad ? [{ id: "F2:journey", owners: ["F2"], trace: "F2 failed journey", step: "journey" }] : [],
          kind: "gate",
        };
      },
      land: async (subset) => {
        landed.push(subset.map((feature) => feature.featureId));
      },
      evict: (feature) => {
        evicted.push(feature.featureId);
      },
      interact: async () => {
        throw new Error("a single bad feature is not an interaction");
      },
    });
    await bisector.resolve(features);
    expect(landed).toEqual([["F1"], ["F3"]]);
    expect(evicted).toEqual(["F2"]);
  });

  it("routes a pair that fails only together to the interaction handler", async () => {
    const features = [queued("F1"), queued("F2")];
    const interactions: string[][] = [];
    const bisector = new MergeBatchBisector({
      probe: async (subset) => ({
        ok: subset.length < 2,
        trace: subset.length === 2 ? "duplicate route /settings" : "",
        failingChecks:
          subset.length === 2
            ? [{ id: "combined:duplicate-route:/settings", owners: ["F1", "F2"], trace: "duplicate route /settings", step: "journey" }]
            : [],
        kind: "gate",
      }),
      land: async () => {
        throw new Error("the red pair must not land before the integrator runs");
      },
      evict: () => {
        throw new Error("neither feature fails alone");
      },
      interact: async (subset) => {
        interactions.push(subset.map((feature) => feature.featureId));
      },
    });
    await bisector.resolve(features);
    expect(interactions).toEqual([["F1", "F2"]]);
  });
});
