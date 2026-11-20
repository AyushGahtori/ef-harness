import { describe, expect, it } from "vitest";

import { CompletionWaveController } from "../../src/final-audit/completion-wave-controller.js";
import { GREEN_VERDICT, needsReviewVerdict, RESIDUAL_CHOICES } from "../../src/final-audit/constants.js";
import { DeterministicRepoAuditor } from "../../src/final-audit/deterministic-repo-auditor.js";
import { CompletionWaveNotReadyError } from "../../src/final-audit/errors.js";
import { createLocalStaticAuditGate } from "../../src/final-audit/repo-scan.js";
import { FinalAuditStore } from "../../src/final-audit/state-db.js";
import { cleanSnapshot, doneFeature, emptyAudit, waveRequest } from "./support.js";
import type { CompletionWaveRequest } from "../../src/final-audit/completion-wave-controller.js";

async function run(overrides: Partial<CompletionWaveRequest> = {}, deps?: { store?: FinalAuditStore; auditor?: DeterministicRepoAuditor }) {
  const store = deps?.store ?? FinalAuditStore.open();
  const controller = new CompletionWaveController({ store, auditor: deps?.auditor });
  try {
    return await controller.run(waveRequest(overrides));
  } finally {
    if (!deps?.store) controller.close();
  }
}

function appSnapshot() {
  const snapshot = cleanSnapshot();
  snapshot.files.push({ path: "src/app.ts", content: "export const app = 1;\n" });
  return snapshot;
}

describe("completion wave bounds, evidence, regression, and resume", () => {
  it("finishes a clean project in one pass with zero fix rounds and a green landing summary", async () => {
    const order: string[] = [];
    const result = await run({
      checkRunner: {
        async run(check) {
          order.push(check);
          return { passed: true, detail: "ok" };
        },
      },
      verifier: {
        async runCombined() {
          order.push("suite");
          return { passed: true, cases: [{ id: "leaf-1", kind: "leaf", passed: true, featureId: "F-Orders" }, { id: "journey-1", kind: "feature_journey", passed: true, featureId: "F-Orders" }, { id: "sealed-1", kind: "sealed_hidden", passed: true, featureId: "F-Orders" }] };
        },
      },
      boot: {
        async boot() {
          order.push("boot");
          return { baseUrl: null, pid: 1, alive: () => false, async stop() { order.push("stop"); } };
        },
      },
      model: {
        async audit() {
          order.push("model");
          return emptyAudit();
        },
      },
    });
    expect(result.fixRounds).toBe(0);
    expect(result.fixTasks).toEqual([]);
    expect(result.llmTokens.layerA).toBe(0);
    expect(result.llmTokens.layerB).toBe(0);
    expect(result.summary.verdict).toBe(GREEN_VERDICT);
    expect(result.summary.readyToLand).toBe(true);
    expect(result.summary.choices).toBeNull();
    expect(result.summary.plainEnglish).toContain("F-Orders");
    expect(result.summary.plainEnglish).toContain("Email the catering totals");
    expect(result.summary.plainEnglish).toContain("Native mobile app");
    expect(result.summary.spend.paperworkWithinCap).toBe(true);
    expect(order.indexOf("suite")).toBeLessThan(order.indexOf("model"));
    expect(order.indexOf("boot")).toBeLessThan(order.indexOf("model"));
    expect(result.summary.presentation).toBe("ship-build");
  });

  it("refuses to start until every planned feature is DONE on harness/integration", async () => {
    const calls: string[] = [];
    await expect(
      run({
        waves: [{ id: "wave-1", features: [{ ...doneFeature(), state: "MERGED" }] }],
        model: { async audit() { calls.push("model"); return emptyAudit(); } },
      }),
    ).rejects.toBeInstanceOf(CompletionWaveNotReadyError);
    expect(calls).toEqual([]);
  });

  it("drops a ghost path and keeps cosmetic naming nits out of the fix queue", async () => {
    const applied: string[] = [];
    const result = await run({
      snapshot: appSnapshot(),
      shardInputs: {
        features: [{ id: "F-Orders", requirements: [{ id: "SI-1", text: "Staff can order lunch" }], files: [{ path: "src/app.ts", content: "export const app = 1;\n" }], diff: "diff app" }],
        seams: [],
        rules: [],
      },
      model: {
        async audit() {
          return {
            missing: [
              { requirement: "SI-1", location: "src/ghost.ts:99", detail: "Ghost file is missing the order total" },
              { requirement: "SI-1", location: "src/app.ts:99", detail: "Line 99 is outside the file" },
              ...Array.from({ length: 12 }, (_, index) => ({
                requirement: "SI-1",
                location: "src/app.ts:1",
                detail: `Consider refactoring helper naming in helper ${index}`,
              })),
            ],
            stubbed: [],
            unhandled_edge_cases: [],
            weak_checks: [],
            verdict: "incomplete",
          };
        },
      },
      fixExecutor: {
        async apply(tasks) {
          applied.push(...tasks.map((task) => task.id));
          return { changedFiles: [] };
        },
      },
    });
    expect(applied).toEqual([]);
    expect(result.fixTasks).toEqual([]);
    expect(result.fixRounds).toBe(0);
    expect(result.summary.optionalFollowUps).toHaveLength(12);
    expect(result.summary.optionalFollowUpsLabel).toBe("Optional Follow-Ups");
    expect(result.summary.readyToLand).toBe(true);
    expect(result.summary.verdict).toBe(GREEN_VERDICT);
  });

  it("stops after two fix rounds and reports the residual instead of opening round 3", async () => {
    let calls = 0;
    const applied: number[] = [];
    const result = await run({
      snapshot: appSnapshot(),
      shardInputs: {
        features: [{ id: "F-Orders", requirements: [{ id: "SI-1", text: "Staff can order lunch" }], files: [{ path: "src/app.ts", content: "export const app = 1;\n" }], diff: "diff app" }],
        seams: [],
        rules: [],
      },
      model: {
        async audit() {
          calls += 1;
          return {
            missing: [{ requirement: "SI-1", location: "src/app.ts:1", detail: `integration gap ${calls} remains at the cited line` }],
            stubbed: [],
            unhandled_edge_cases: [],
            weak_checks: [],
            verdict: "incomplete",
          };
        },
      },
      fixExecutor: {
        async apply(tasks) {
          applied.push(tasks.length);
          return { changedFiles: ["src/app.ts"] };
        },
      },
    });
    expect(applied).toEqual([1, 1]);
    expect(result.fixRounds).toBe(2);
    expect(result.roundCapHit).toBe(true);
    expect(calls).toBe(3);
    expect(result.summary.readyToLand).toBe(false);
    expect(result.summary.verdict).toBe(needsReviewVerdict(1));
    expect(result.summary.plainEnglish).toContain("integration gap 3 remains");
    expect(result.summary.choices).toEqual(RESIDUAL_CHOICES);
  });

  it("stops at the 10% fix budget and offers land, manual fix, or extra budget for the remaining medium edge", async () => {
    const fixed = new Set<string>();
    const critical = "Orders total ignores the voided line";
    const medium = "The empty menu state has no illustration when there are zero orders.";
    const applied: string[] = [];
    const result = await run({
      projectBudgetUnits: 1_000n,
      defaultFixCostUnits: 100n,
      snapshot: appSnapshot(),
      shardInputs: {
        features: [{ id: "F-Orders", requirements: [{ id: "SI-1", text: "Staff can order lunch" }], files: [{ path: "src/app.ts", content: "export const app = 1;\n" }], diff: "diff app" }],
        seams: [],
        rules: [],
      },
      model: {
        async audit() {
          return {
            missing: fixed.has(critical) ? [] : [{ requirement: "SI-1", location: "src/app.ts:1", detail: critical }],
            stubbed: [],
            unhandled_edge_cases: [{ requirement: "SI-1", location: "src/app.ts:1", detail: medium }],
            weak_checks: [],
            verdict: "incomplete",
          };
        },
      },
      fixExecutor: {
        async apply(tasks) {
          for (const task of tasks) {
            applied.push(task.detail);
            fixed.add(task.detail);
          }
          return { changedFiles: ["src/app.ts"] };
        },
      },
    });
    expect(applied).toEqual([critical]);
    expect(result.fixRounds).toBe(1);
    expect(result.budgetCapHit).toBe(true);
    expect(result.summary.spend.auditFixUnits).toBe(100n);
    expect(result.summary.spend.auditFixCapUnits).toBe(100n);
    expect(result.summary.verdict).toBe(needsReviewVerdict(1));
    expect(result.summary.unresolvedFindings.map((finding) => finding.detail)).toEqual([medium]);
    expect(result.summary.choices).toEqual(["Land as-is", "Fix manually", "Allocate extra fix budget"]);
    expect(result.fixRounds).toBeLessThanOrEqual(2);
  });

  it("catches an audit fix that breaks a previously passing auth test before landing", async () => {
    let suites = 0;
    const result = await run({
      snapshot: appSnapshot(),
      shardInputs: {
        features: [{ id: "F-Orders", requirements: [{ id: "SI-1", text: "Staff can order lunch" }], files: [{ path: "src/app.ts", content: "export const app = 1;\n" }], diff: "diff app" }],
        seams: [],
        rules: [],
      },
      verifier: {
        async runCombined() {
          suites += 1;
          const passed = suites === 1;
          return {
            passed,
            cases: [{ id: "auth-wave1", kind: "leaf", passed, featureId: "F-Auth" }],
          };
        },
      },
      model: {
        async audit() {
          return {
            missing: [{ requirement: "SI-1", location: "src/app.ts:1", detail: "Billing receipt drops the tax line" }],
            stubbed: [],
            unhandled_edge_cases: [],
            weak_checks: [],
            verdict: "incomplete",
          };
        },
      },
      fixExecutor: {
        async apply() {
          return { changedFiles: ["src/app.ts"] };
        },
      },
    });
    expect(suites).toBeGreaterThanOrEqual(2);
    expect(result.fixRounds).toBe(1);
    expect(result.fixRounds).toBeLessThanOrEqual(2);
    expect(result.regressions.map((item) => item.caseId)).toEqual(["auth-wave1"]);
    expect(result.summary.readyToLand).toBe(false);
    expect(result.summary.plainEnglish).toContain("auth-wave1");
    expect(result.summary.verdict.startsWith("Green")).toBe(false);
  });

  it("resumes layer A and unfinished shards without repeating completed work", async () => {
    const store = FinalAuditStore.open();
    let typechecks = 0;
    let staticCalls = 0;
    const auditor = new DeterministicRepoAuditor({
      fixCostUnits: 1n,
      staticAudit: {
        auditFeature(snapshot) {
          staticCalls += 1;
          return createLocalStaticAuditGate(1n).auditFeature(snapshot);
        },
      },
    });
    const runner = {
      async run(check: "production_build" | "typecheck" | "lint") {
        if (check === "typecheck") {
          typechecks += 1;
          if (typechecks === 1) throw new Error("crash-typecheck");
        }
        return { passed: true, detail: "ok" };
      },
    };
    const controller = new CompletionWaveController({ store, auditor });
    await expect(controller.run(waveRequest({ checkRunner: runner }))).rejects.toThrow(/crash-typecheck/);
    const continued = await controller.run(waveRequest({ checkRunner: runner }));
    expect(staticCalls).toBe(1);
    expect(typechecks).toBe(2);
    expect(continued.summary.readyToLand).toBe(true);

    const shardStore = FinalAuditStore.open();
    const seen: string[] = [];
    let crashed = false;
    const shardController = new CompletionWaveController({ store: shardStore });
    const shardRequest = waveRequest({
      concurrency: 1,
      shardInputs: {
        features: ["F-01", "F-02", "F-03", "F-04"].map((id) => ({
          id,
          requirements: [{ id: "SI-1", text: `text ${id}` }],
          files: [{ path: "src/mod.ts", content: "export function used() { return 1; }\n" }],
          diff: id,
        })),
        seams: [],
        rules: [],
      },
      model: {
        async audit(input) {
          seen.push(input.shardId);
          if (!crashed && input.shardId === "feature:F-03") {
            crashed = true;
            throw new Error("crash-shard");
          }
          return emptyAudit();
        },
      },
    });
    await expect(shardController.run(shardRequest)).rejects.toThrow(/crash-shard/);
    const beforeResume = seen.length;
    const resumed = await shardController.run(shardRequest);
    expect(seen.slice(beforeResume)).toEqual(["feature:F-03", "feature:F-04"]);
    expect(resumed.summary.readyToLand).toBe(true);
    store.close();
    shardStore.close();
  });
});
