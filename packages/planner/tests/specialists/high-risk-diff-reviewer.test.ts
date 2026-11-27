import { afterEach, describe, expect, it } from "vitest";
import { createCompletenessGateRunner } from "@ef-harness/completeness-gate";
import { bindBudgetLedger } from "@ef-harness/db";
import {
  FakeModelAdapter,
  HighRiskDiffReviewer,
  MemoryHintLadder,
  MemoryReviewEnvelope,
  SpecialistStateDb,
  bindBudgetLedgerReviewEnvelope,
  bindCompletenessGate,
  checkCitation,
  parseReviewerV1,
} from "../../src/specialists/index.js";
import type { HighRiskReviewRequest, ModelRosterEntry } from "../../src/specialists/index.js";
import { SequentialBuildRunner } from "../../src/sequential-runner/index.js";
import { feature, lab, task, writingWorker, type Lab } from "../sequential-runner/helpers.js";

const ROSTER: readonly ModelRosterEntry[] = [
  { family: "openai", vision: false, level: "Senior" },
  { family: "anthropic", vision: true, level: "Senior" },
];

const IDOR_DIFF = [
  "diff --git a/src/orders.ts b/src/orders.ts",
  "index 1111111..2222222 100644",
  "--- a/src/orders.ts",
  "+++ b/src/orders.ts",
  "@@ -10,4 +10,6 @@",
  "   if (!req.user) {",
  "     return res.status(401);",
  "   }",
  "+  db.run(`DELETE FROM orders WHERE id = ${req.params.id}`);",
  "+  return res.status(204);",
  " }",
].join("\n");

const IDOR_FINDING = {
  kind: "unsafe",
  location: "src/orders.ts:13-14",
  explanation:
    "X-02: DELETE checks that req.user exists but omits AND user_id = req.user.id, so any signed-in user can delete another user's order.",
};

function request(overrides: Partial<HighRiskReviewRequest> = {}): HighRiskReviewRequest {
  return {
    taskId: "T-ORDERS",
    attemptId: "A-1",
    touches: ["auth"],
    hintRetryLevel: 0,
    tagDrift: false,
    diff: IDOR_DIFF,
    must: [{ id: "REQ-DELETE", text: "A user can delete only their own order." }],
    rules: [{ id: "X-02", text: "Every order mutation is scoped to the signed-in user." }],
    staticAudit: {
      taskId: "T-ORDERS",
      passed: true,
      fingerprint: "audit-fp-1",
      hardFindingCount: 0,
      softFindingCount: 0,
    },
    workerFamily: "openai",
    ...overrides,
  };
}

function cssDiff(): string {
  const lines = [
    "diff --git a/src/tokens.css b/src/tokens.css",
    "--- a/src/tokens.css",
    "+++ b/src/tokens.css",
    "@@ -1,2 +1,18 @@",
    " :root {",
  ];
  for (let index = 0; index < 16; index += 1) {
    lines.push(`+  --space-${String(index)}: 4px;`);
  }
  lines.push(" }");
  return lines.join("\n");
}

describe("HighRiskDiffReviewer", { timeout: 60_000, hookTimeout: 30_000 }, () => {
  const dbs: SpecialistStateDb[] = [];
  const labs: Lab[] = [];

  afterEach(() => {
    for (const db of dbs.splice(0)) db.close();
    for (const env of labs.splice(0)) env.cleanup();
  });

  it("skips a UI-only token rename and spends zero tokens", async () => {
    const model = new FakeModelAdapter().enqueue("reviewer@1", {
      findings: [IDOR_FINDING],
      verdict: "concerns",
    });
    const envelope = new MemoryReviewEnvelope(10_000);
    const reviewer = new HighRiskDiffReviewer({ model, roster: ROSTER, envelope });
    const result = await reviewer.review(
      request({
        touches: ["ui"],
        diff: cssDiff(),
        hintRetryLevel: 0,
        tagDrift: false,
      }),
    );
    expect(result.status).toBe("skipped_low_risk");
    expect(result.tokensSpent).toBe(0);
    expect(result.modelInvoked).toBe(false);
    expect(result.blocksMerge).toBe(false);
    expect(model.calls).toHaveLength(0);
    expect(envelope.spentUnits).toBe(0);
    expect(cssDiff().split("\n").length).toBeGreaterThanOrEqual(20);
  });

  it("runs for high-risk tags, canonical aliases, hint 2, and tag drift", async () => {
    const model = new FakeModelAdapter();
    const reviewer = new HighRiskDiffReviewer({ model, roster: ROSTER });
    for (const touches of [
      ["payments"],
      ["pii"],
      ["migrations"],
      ["security"],
      ["external_side_effect"],
      ["concurrency"],
      ["authz"],
    ]) {
      model.enqueue("reviewer@1", { findings: [], verdict: "ok" });
      const result = await reviewer.review(request({ touches }));
      expect(result.status).toBe("clean");
    }
    model.enqueue("reviewer@1", { findings: [], verdict: "ok" });
    expect((await reviewer.review(request({ touches: ["ui"], hintRetryLevel: 1 }))).status).toBe(
      "skipped_low_risk",
    );
    model.enqueue("reviewer@1", { findings: [], verdict: "ok" });
    expect((await reviewer.review(request({ touches: ["ui"], hintRetryLevel: 2 }))).status).toBe("clean");
    model.enqueue("reviewer@1", { findings: [], verdict: "ok" });
    expect((await reviewer.review(request({ touches: ["ui"], tagDrift: true }))).status).toBe("clean");
  });

  it("blocks a cited IDOR, feeds the hint ladder, and stays on an independent family", async () => {
    const model = new FakeModelAdapter().enqueue("reviewer@1", {
      findings: [IDOR_FINDING],
      verdict: "concerns",
    });
    const ladder = new MemoryHintLadder();
    const envelope = new MemoryReviewEnvelope(10_000);
    const reviewer = new HighRiskDiffReviewer({ model, roster: ROSTER, hintLadder: ladder, envelope });
    const result = await reviewer.review(request());
    expect(result.status).toBe("blocked_merge");
    if (result.status !== "blocked_merge") return;
    expect(result.blocksMerge).toBe(true);
    expect(result.rejectionNumber).toBe(1);
    expect(result.family).toBe("anthropic");
    expect(result.familyDegraded).toBe(false);
    expect(result.envelopeCharged).toBe(true);
    expect(result.findings[0]?.violatedRuleOrReqId).toBe("X-02");
    expect(result.findings[0]?.filePath).toBe("src/orders.ts");
    expect(result.findings[0]?.lineRange).toEqual({ start: 13, end: 14 });
    expect(result.findings[0]?.concreteExploitOrFailureScenario).toContain("another user");
    expect(result.hint).toContain("src/orders.ts");
    expect(result.hint).toContain("X-02");
    expect(ladder.pushes).toHaveLength(1);
    expect(ladder.pushes[0]?.countsTowardReviewEnvelope).toBe(true);
    expect(envelope.spentUnits).toBe(result.tokensSpent);
    const prompt = model.calls[0]?.prompt ?? "";
    expect(prompt).toContain("X-02");
    expect(prompt).toContain("audit-fp-1");
    expect(prompt).toContain("DELETE FROM orders");
    expect(prompt).not.toContain("UNRELATED_FILE_SENTINEL");
  });

  it("downgrades a naming nit with no violated rule and drops an ungrounded line", async () => {
    const model = new FakeModelAdapter().enqueue("reviewer@1", {
      findings: [
        {
          kind: "weakened_logic",
          location: "src/orders.ts:12-12",
          explanation: "rename 'ord' to 'orderItem'",
        },
        {
          kind: "unsafe",
          location: "src/orders.ts:90-91",
          explanation: "X-02: this line is not in the diff so it cannot block the merge for another user.",
        },
      ],
      verdict: "concerns",
    });
    const ladder = new MemoryHintLadder();
    const reviewer = new HighRiskDiffReviewer({ model, roster: ROSTER, hintLadder: ladder });
    const result = await reviewer.review(request());
    expect(result.status).toBe("clean");
    if (result.status !== "clean") return;
    expect(result.blocksMerge).toBe(false);
    expect(result.advisory).toHaveLength(1);
    expect(result.advisory[0]?.text).toContain("rename");
    expect(result.advisory[0]?.blocksMerge).toBe(false);
    expect(ladder.pushes).toHaveLength(0);
  });

  it("does not treat an invalid verdict or a blocked exit as a rejection", async () => {
    const model = new FakeModelAdapter()
      .enqueue("reviewer@1", { verdict: "ok", findings: [IDOR_FINDING] })
      .enqueue("reviewer@1", { blocked: true, reason: "diff was truncated" });
    const reviewer = new HighRiskDiffReviewer({ model, roster: ROSTER });
    const invalid = await reviewer.review(request());
    expect(invalid.status).toBe("model_output_invalid");
    expect(invalid.blocksMerge).toBe(false);
    const blocked = await reviewer.review(request());
    expect(blocked.status).toBe("model_blocked");
    expect(blocked.blocksMerge).toBe(false);
    expect(parseReviewerV1({ verdict: "ok", findings: [IDOR_FINDING] }).ok).toBe(false);
  });

  it("escalates on the third dispute instead of rejecting again", async () => {
    const model = new FakeModelAdapter();
    const ladder = new MemoryHintLadder();
    const reviewer = new HighRiskDiffReviewer({ model, roster: ROSTER, hintLadder: ladder });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      model.enqueue("reviewer@1", { findings: [IDOR_FINDING], verdict: "concerns" });
    }
    const first = await reviewer.review(request());
    const second = await reviewer.review(request());
    const third = await reviewer.review(request());
    expect(first.status).toBe("blocked_merge");
    expect(second.status).toBe("blocked_merge");
    if (first.status === "blocked_merge") expect(first.rejectionNumber).toBe(1);
    if (second.status === "blocked_merge") expect(second.rejectionNumber).toBe(2);
    expect(third.status).toBe("escalated_to_user");
    if (third.status !== "escalated_to_user") return;
    expect(third.blocksMerge).toBe(false);
    expect(third.attempt).toBe(3);
    expect(third.priorRejections).toBe(2);
    expect(third.diff).toContain("DELETE FROM orders");
    expect(third.concern).toContain("X-02");
    expect(ladder.pushes).toHaveLength(2);
  });

  it("marks the family degraded when only the worker family is connected", async () => {
    const model = new FakeModelAdapter().enqueue("reviewer@1", { findings: [], verdict: "ok" });
    const reviewer = new HighRiskDiffReviewer({
      model,
      roster: [{ family: "openai", vision: false, level: "Mid" }],
    });
    const result = await reviewer.review(request());
    expect(result.status).toBe("clean");
    if (result.status !== "clean") return;
    expect(result.family).toBe("openai");
    expect(result.familyDegraded).toBe(true);
  });

  it("rejects a citation whose lines are outside the diff", () => {
    const files = new Map<string, Set<number>>([["src/orders.ts", new Set([13, 14])]]);
    const ground = { files, nodeIds: new Set<string>(), receiptIds: new Set<string>() };
    expect(checkCitation({ filePath: "src/orders.ts", lineRange: { start: 13, end: 14 } }, ground).ok).toBe(true);
    expect(checkCitation({ filePath: "src/orders.ts", lineRange: { start: 90, end: 91 } }, ground).ok).toBe(false);
    expect(checkCitation({ nodeId: "T-MISSING" }, ground).ok).toBe(false);
    expect(checkCitation({ receiptId: "rcpt-missing" }, ground).ok).toBe(false);
  });

  it("binds BudgetLedgerRepo and CompletenessGateRunner asynchronously", async () => {
    const specDb = SpecialistStateDb.memory();
    dbs.push(specDb);
    const ledger = bindBudgetLedger(specDb.stateDb);
    const envelope = bindBudgetLedgerReviewEnvelope(ledger, {
      scopeKind: "project",
      scopeId: "proj-specialists",
      limitUnits: 20_000,
    });
    const gate = bindCompletenessGate(createCompletenessGateRunner(), (taskId) => ({
      taskId,
      featureId: "F-ORDERS",
      actor: "worker",
      baseRef: "HEAD~1",
      candidateRef: "HEAD",
      files: [{ path: "src/orders.ts", status: "modified", afterText: "export const ok = true;\n" }],
      produces: [],
      schemaFields: [],
      staticData: [],
      approvedDeferralIds: [],
      excludedGeneratedPaths: [],
      seedFixturePaths: [],
      protectedTestPaths: [],
      protectedTestConfigPaths: [],
      lockedSnapshotPaths: [],
      verificationScopeGrant: false,
      writeScope: ["src/"],
      integratorConflictHunks: [],
      declaredSharedFiles: [],
      errorHandlingRequiresSurface: false,
      entryPoints: [],
      registeredAssets: [],
      publicFiles: [],
      assetModuleSources: [],
      visibleExampleLiterals: [],
      deletionDeclared: false,
      justifiedTaskNotes: [],
      registry: { names: [] },
      vaultSecrets: [],
    }));
    const model = new FakeModelAdapter().enqueue("reviewer@1", {
      findings: [IDOR_FINDING],
      verdict: "concerns",
    });
    const reviewer = new HighRiskDiffReviewer({
      model,
      roster: ROSTER,
      envelope,
      staticAuditGate: gate,
    });
    const res = await reviewer.review(request({ staticAudit: null }));
    expect(res.status).toBe("blocked_merge");
    expect(envelope.spentUnits).toBe(res.tokensSpent);
    expect(model.calls[0]?.prompt).toContain("passed");
  });

  it("wires optional HighRiskDiffReviewer into SequentialBuildRunner", async () => {
    const env = lab();
    labs.push(env);
    env.db.ensureProject({ wave: 1, gate0: "PASSED" });
    feature(env, "auth", 1);
    task(env, { id: "T-auth", feature: "auth", title: "Auth endpoint", basis: "explicit", tags: ["auth"] });

    const model = new FakeModelAdapter()
      .enqueue("reviewer@1", {
        findings: [
          {
            kind: "unsafe",
            location: "src/T-auth.ts:1-1",
            explanation: "T-auth: missing user check allows another user to bypass auth.",
          },
        ],
        verdict: "concerns",
      })
      .enqueue("reviewer@1", { findings: [], verdict: "ok" });

    const reviewer = new HighRiskDiffReviewer({ model, roster: ROSTER });
    const runner = new SequentialBuildRunner({
      db: env.db,
      git: env.git,
      worker: writingWorker((ctx) =>
        ctx.hintStep === 0
          ? "export const unsafe = req.params.id;\n"
          : "export const safe = req.user.id;\n",
      ),
      reviewer,
    });
    const report = await runner.run({ maxTasks: 5 });
    expect(report.merged).toContain("T-auth");
    expect(model.calls).toHaveLength(2);
  });
});
