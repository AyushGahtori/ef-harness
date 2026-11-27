import { describe, expect, it } from "vitest";
import {
  ExpectedCostLevelSelector,
  HistoricalPassRateCalibrator,
  VersionedModelRoster,
  selectionInput,
} from "../../src/crew-levels/index.js";
import type {
  CompiledTaskFeatures,
  CrewPreset,
  LevelAssignment,
  LevelSelectionInput,
  VersionedModelRoster as Roster,
} from "../../src/crew-levels/index.js";
import { blankTask, complexTask, model } from "./fixtures.js";

function rosterOf(...entries: Parameters<typeof model>[0][]): Roster {
  return VersionedModelRoster.seed(entries.map((entry) => model(entry)));
}

function assign(
  roster: Roster,
  task: CompiledTaskFeatures,
  preset: CrewPreset,
  options: Omit<Parameters<typeof selectionInput>[3], never> = {},
): LevelAssignment {
  const selector = new ExpectedCostLevelSelector(
    roster,
    HistoricalPassRateCalibrator.fromRoster(roster, []),
  );
  const input: LevelSelectionInput = selectionInput(task, preset, options.connections ? "micro-usd" : "micro-usd", {
    paidFallbackApproved: true,
    ...options,
  });
  return selector.select(input);
}

function quote(assignment: LevelAssignment, level: LevelAssignment["level"]) {
  return assignment.compared.find((item) => item.level === level);
}

describe("ExpectedCostLevelSelector", () => {
  const crossover = () =>
    rosterOf(
      { modelId: "junior", tier: "junior", rate: 20_000n, priors: { complex: 0.2, trivial: 0.96, critical: 0.98 } },
      { modelId: "mid", tier: "mid", rate: 80_000n, priors: { complex: 0.88, trivial: 0.97 } },
      { modelId: "senior", tier: "senior", rate: 150_000n, priors: { complex: 0.98, trivial: 0.98, critical: 0.9 } },
    );

  it("picks Mid under Cheapest when a cheap low pass-rate Junior has the higher expected cost", () => {
    const assignment = assign(crossover(), complexTask(), "cheapest");
    expect(assignment.status).toBe("assigned");
    expect(assignment.level).toBe("mid");
    expect(assignment.modelId).toBe("mid");
    expect(assignment.difficulty).toBe("complex");
    const junior = quote(assignment, "junior");
    const mid = quote(assignment, "mid");
    const senior = quote(assignment, "senior");
    expect(junior?.unitCost).toBe(20_000n);
    expect(mid?.unitCost).toBe(80_000n);
    expect(junior?.sameLevelRetryCost).toBe(100_000n);
    expect(mid?.sameLevelRetryCost).toBe(90_909n);
    expect(senior?.sameLevelRetryCost).toBe(153_061n);
    expect(junior?.expectedCost).toBe(164_000n);
    expect(mid?.expectedCost).toBe(108_909n);
    expect(assignment.expectedCost).toBe(108_909n);
    expect(junior!.unitCost < mid!.unitCost).toBe(true);
    expect(junior!.expectedCost > mid!.expectedCost).toBe(true);
    expect(assignment.rationale).toBe(
      "Assigned Mid (est. $0.109, 88% 1st-pass) — Junior expected cost higher due to retry risk",
    );
    expect(assignment.rationale.includes("\n")).toBe(false);
    expect(assign(crossover(), complexTask(), "cheapest")).toEqual(assignment);
  });

  it("keeps Cheapest on expected cost and raises first-pass probability for critical-path Fastest and Balanced", () => {
    const task = complexTask();
    const roster = crossover();
    expect(assign(roster, task, "cheapest", { onCriticalPath: true }).level).toBe("mid");
    expect(assign(roster, task, "fastest", { onCriticalPath: true }).level).toBe("senior");
    const balanced = assign(roster, task, "balanced", { onCriticalPath: true });
    expect(balanced.level).toBe("senior");
    expect(balanced.criticalPathBoost).toBe(true);
    expect(balanced.rationale).toContain("critical path prefers higher first-pass probability");
    expect(assign(roster, task, "fastest", { onCriticalPath: false }).level).toBe("mid");
  });

  it("holds auth, payments, migrations, and oracle-author at Senior under Cheapest", () => {
    const roster = rosterOf(
      { modelId: "junior", tier: "junior", rate: 1_000n, priors: { critical: 0.98 } },
      { modelId: "senior", tier: "senior", rate: 400_000n, priors: { critical: 0.9 } },
    );
    const cases: CompiledTaskFeatures[] = [
      blankTask({ riskTags: ["auth"] }),
      blankTask({ riskTags: ["payments"] }),
      blankTask({ riskTags: ["migrations"] }),
      blankTask({ migrationKind: "destructive" }),
      blankTask({ migrationKind: "expand-contract" }),
      blankTask({ crossFeatureConflictMerge: true }),
    ];
    for (const task of cases) {
      const assignment = assign(roster, task, "cheapest");
      expect(assignment.level).toBe("senior");
      expect(assignment.floor).toBe("senior");
      expect(assignment.floorHeld).toBe(true);
      expect(assignment.rationale).toContain("safety floor");
    }
    const oracle = assign(roster, blankTask(), "cheapest", { role: "oracle-author@1" });
    expect(oracle.level).toBe("senior");
    expect(oracle.difficulty).toBe("critical");
  });

  it("does not floor a concurrency task when Junior has the lower expected cost", () => {
    const roster = rosterOf(
      { modelId: "junior", tier: "junior", rate: 1_000n, priors: { complex: 0.98 } },
      { modelId: "senior", tier: "senior", rate: 400_000n, priors: { complex: 0.9 } },
    );
    const assignment = assign(roster, blankTask({ riskTags: ["concurrency"] }), "cheapest");
    expect(assignment.difficulty).toBe("complex");
    expect(assignment.level).toBe("junior");
  });

  it("escalates one level on Hint 2 and not on Hint 1", () => {
    const roster = rosterOf(
      { modelId: "junior", tier: "junior", rate: 1_000n, priors: { trivial: 0.96 } },
      { modelId: "mid", tier: "mid", rate: 50_000n, priors: { trivial: 0.97 } },
      { modelId: "senior", tier: "senior", rate: 80_000n, priors: { trivial: 0.98 } },
    );
    const task = blankTask();
    expect(assign(roster, task, "cheapest").level).toBe("junior");
    expect(assign(roster, task, "cheapest", { failedAttempts: 1 }).level).toBe("junior");
    const hint2 = assign(roster, task, "cheapest", { failedAttempts: 2 });
    expect(hint2.level).toBe("mid");
    expect(hint2.escalated).toBe(true);
    expect(hint2.rationale).toContain("escalated after Hint 2");
    expect(assign(roster, task, "cheapest", { failedAttempts: 3 }).level).toBe("senior");
  });

  it("maps a single connected model onto the task and still rejects missing tool support", () => {
    const only = rosterOf({
      modelId: "llama-14b",
      tier: "junior",
      spendKind: "local",
      family: "llama",
      rate: 0n,
      contextWindow: 8_192,
    });
    const mapped = assign(only, blankTask(), "cheapest", { paidFallbackApproved: false });
    expect(mapped.singleModelMode).toBe(true);
    expect(mapped.modelId).toBe("llama-14b");
    expect(mapped.rationale).toContain("single_model_mode");

    const noTools = rosterOf({
      modelId: "llama-14b",
      tier: "junior",
      spendKind: "local",
      tools: false,
      json: false,
      contextWindow: 8_192,
    });
    const blocked = assign(noTools, blankTask(), "cheapest", { paidFallbackApproved: false });
    expect(blocked.status).toBe("blocked");
    expect(blocked.blockReason).toBe("capability_unavailable");
    expect(blocked.singleModelMode).toBe(false);
  });

  it("uses the only local model for a critical task and skips micro locals when a stronger model exists", () => {
    const onlyMicro = rosterOf({
      modelId: "tiny",
      tier: "junior",
      spendKind: "local",
      contextWindow: 4_096,
      rate: 0n,
    });
    const alone = assign(onlyMicro, blankTask({ riskTags: ["auth"] }), "cheapest", {
      paidFallbackApproved: false,
    });
    expect(alone.singleModelMode).toBe(true);
    expect(alone.level).toBe("senior");
    expect(alone.modelTier).toBe("junior");
    expect(alone.floorHeld).toBe(false);

    const withAlternative = rosterOf(
      {
        modelId: "tiny",
        tier: "senior",
        spendKind: "local",
        family: "llama",
        contextWindow: 4_096,
        rate: 0n,
        priors: { critical: 0.99 },
      },
      { modelId: "api-senior", tier: "senior", family: "anthropic", rate: 200_000n, priors: { critical: 0.8 } },
      { modelId: "api-mid", tier: "mid", family: "anthropic", rate: 80_000n, priors: { critical: 0.7 } },
    );
    const chosen = assign(withAlternative, blankTask({ riskTags: ["payments"] }), "cheapest");
    expect(chosen.modelId).toBe("api-senior");
    expect(chosen.singleModelMode).toBe(false);
  });

  it("does not silently fall back to a paid API and does not mix ppm with micro-USD", () => {
    const revoked = rosterOf(
      { modelId: "local-main", tier: "mid", spendKind: "local", rate: 0n, family: "llama" },
      { modelId: "paid", tier: "senior", rate: 50_000n, family: "anthropic" },
    ).applySignedPolicy({
      revision: 2,
      signed: true,
      revokeModelIds: ["local-main"],
      upserts: [],
      deprecations: [],
    });
    const selector = new ExpectedCostLevelSelector(
      revoked,
      HistoricalPassRateCalibrator.fromRoster(revoked, []),
    );
    const blocked = selector.select(
      selectionInput(blankTask(), "cheapest", "micro-usd", { paidFallbackApproved: false }),
    );
    expect(blocked.status).toBe("blocked");
    expect(blocked.blockReason).toBe("paid_fallback_not_approved");
    expect(blocked.modelId).toBeNull();
    expect(blocked.rationale).toContain("paid fallback not approved");

    const mixed = rosterOf(
      {
        modelId: "sub-junior",
        tier: "junior",
        spendKind: "subscription",
        allowancePpmPer1M: 100n,
        connectionId: "chatgpt",
        priors: { complex: 0.2 },
      },
      {
        modelId: "sub-mid",
        tier: "mid",
        spendKind: "subscription",
        allowancePpmPer1M: 500n,
        connectionId: "chatgpt",
        priors: { complex: 0.88 },
      },
      { modelId: "paid", tier: "junior", rate: 1n, priors: { complex: 0.99 } },
    );
    const ppmSelector = new ExpectedCostLevelSelector(
      mixed,
      HistoricalPassRateCalibrator.fromRoster(mixed, []),
    );
    const ppm = ppmSelector.select(
      selectionInput(complexTask(), "cheapest", "ppm", { paidFallbackApproved: false }),
    );
    expect(ppm.modelId).toBe("sub-mid");
    expect(ppm.currency).toBe("ppm");
    expect(ppm.rationale.includes("$")).toBe(false);
    expect(ppm.rationale).toContain("ppm");
    expect(ppm.compared.every((item) => item.currency === "ppm")).toBe(true);
  });

  it("reselects after revocation, chooses a different family for review roles, and reports a budget shortfall", () => {
    const families = rosterOf(
      { modelId: "openai-senior", tier: "senior", family: "openai", rate: 100_000n },
      { modelId: "anthropic-senior", tier: "senior", family: "anthropic", rate: 100_000n },
      { modelId: "anthropic-junior", tier: "junior", family: "anthropic", rate: 1_000n },
    );
    const oracle = assign(families, blankTask(), "cheapest", {
      role: "oracle-author@1",
      buildWorkerFamily: "openai",
    });
    expect(oracle.family).toBe("anthropic");
    expect(oracle.level).toBe("senior");
    expect(oracle.crossFamily).toBe(true);

    const relaxed = assign(
      rosterOf(
        { modelId: "openai-senior", tier: "senior", family: "openai", rate: 100_000n },
        { modelId: "anthropic-junior", tier: "junior", family: "anthropic", rate: 1_000n },
      ),
      blankTask({ riskTags: ["auth"] }),
      "cheapest",
      { role: "reviewer@1", buildWorkerFamily: "openai" },
    );
    expect(relaxed.modelId).toBe("openai-senior");
    expect(relaxed.crossFamily).toBe(false);
    expect(relaxed.rationale).toContain("safety floor kept the build worker family");

    const deprecated = rosterOf(
      { modelId: "old", tier: "junior", rate: 1n, deprecatedAfter: 10 },
      { modelId: "current", tier: "mid", rate: 5_000n },
    );
    expect(assign(deprecated, blankTask(), "cheapest", { nowMs: 10 }).modelId).toBe("current");

    const shortfall = assign(
      rosterOf(
        { modelId: "junior", tier: "junior", rate: 1_000n, priors: { trivial: 0.96 } },
        { modelId: "mid", tier: "mid", rate: 50_000n, priors: { trivial: 0.97 } },
      ),
      blankTask(),
      "cheapest",
      {
        budget: {
          getBudgetRemaining: () => [{ currency: "usd", remainingUnits: 100, overrun: false }],
        },
        budgetScope: { scopeKind: "task", scopeId: "T-1" },
      },
    );
    expect(shortfall.level).toBe("junior");
    expect(shortfall.budgetShortfall).toBe(true);
    expect(shortfall.floorHeld).toBe(true);

    const otherCurrency = assign(
      rosterOf({ modelId: "junior", tier: "junior", rate: 1_000n, priors: { trivial: 0.96 } }),
      blankTask(),
      "cheapest",
      {
        budget: {
          getBudgetRemaining: () => [
            { currency: "allowance:chatgpt", remainingUnits: 1, overrun: false },
          ],
        },
        budgetScope: { scopeKind: "task", scopeId: "T-1" },
      },
    );
    expect(otherCurrency.budgetShortfall).toBe(false);
  });

  it("requires vision when the task asks for it and stays inside an explicit connection allow-list", () => {
    const roster = rosterOf(
      { modelId: "blind", tier: "senior", vision: false, rate: 1_000n, connectionId: "a" },
      { modelId: "sighted", tier: "mid", vision: true, rate: 8_000n, connectionId: "b", family: "google" },
    );
    const vision = assign(roster, blankTask(), "cheapest", { requiresVision: true });
    expect(vision.modelId).toBe("sighted");
    const allowed = assign(roster, blankTask(), "cheapest", {
      allowedConnectionIds: ["a"],
      connections: [
        { id: "a", provider: "openai", route: "api_key", currency: "usd", enabled: true },
        { id: "b", provider: "google", route: "api_key", currency: "usd", enabled: true },
      ],
    });
    expect(allowed.modelId).toBe("blind");
  });
});
