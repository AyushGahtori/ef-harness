import { describe, expect, it } from "vitest";
import {
  AutoStartGraceWindow,
  DAILY_CAP_MICRO_USD,
  DELTA_COST_CEILING_MICRO_USD,
  DELTA_TASK_CEILING,
  DELTA_WINDOW_CEILING_PPM,
  FirstBuildApprovalGate,
  PAUSE_AFFORDANCE_MS,
  PlanPreviewError,
  PlanSnapshotDiffer,
  ROLLING_WINDOW_MS,
  RevisionAutoStartPolicy,
  UNDO_WINDOW_MS,
  createAutoStartToast,
  type ExternalEffect,
} from "../../src/plan-preview/index.js";
import { candidate } from "./fixtures.js";

describe("FirstBuildApprovalGate", () => {
  const gate = new FirstBuildApprovalGate();

  it("waits for Start build on a tiny first project", () => {
    const waiting = gate.assess({
      isFirstBuild: true,
      explicitStartBuildClick: false,
      estimatedCostMicroUsd: 150_000n,
      taskCount: 2,
    });
    expect(waiting.autoStart).toBe(false);
    expect(waiting.waitingForExplicitStart).toBe(true);
    expect(waiting.mayProceed).toBe(false);
    expect(waiting.message).toBe("Needs approval: first build waits for Start build");

    const clicked = gate.assess({
      isFirstBuild: true,
      explicitStartBuildClick: true,
      estimatedCostMicroUsd: 150_000n,
      taskCount: 2,
    });
    expect(clicked.autoStart).toBe(false);
    expect(clicked.mayProceed).toBe(true);
    expect(clicked.reason).toBe("explicit_start_build");
  });

  it("still refuses auto-start when the first build is large", () => {
    const decision = gate.assess({
      isFirstBuild: true,
      explicitStartBuildClick: false,
      estimatedCostMicroUsd: 50_000_000n,
      taskCount: 40,
    });
    expect(decision.autoStart).toBe(false);
    expect(decision.message).toBe("Needs approval: first build waits for Start build");
  });
});

describe("RevisionAutoStartPolicy", () => {
  it("approves the inclusive boundary and blocks the next step", () => {
    const cases = [
      { name: "5 tasks", patch: { deltaTasks: 5 }, autoStart: true },
      { name: "6 tasks", patch: { deltaTasks: 6 }, autoStart: false },
      { name: "$1.00", patch: { deltaCostMicroUsd: 1_000_000n }, autoStart: true },
      { name: "$1.01", patch: { deltaCostMicroUsd: 1_010_000n }, autoStart: false },
      { name: "2.0%", patch: { deltaPlanWindowPpm: 20_000 }, autoStart: true },
      { name: "2.1%", patch: { deltaPlanWindowPpm: 21_000 }, autoStart: false },
    ];
    for (const entry of cases) {
      const decision = new RevisionAutoStartPolicy().evaluate(candidate(entry.patch));
      expect(decision.autoStart, entry.name).toBe(entry.autoStart);
    }
    const overCost = new RevisionAutoStartPolicy().evaluate(candidate({ deltaTasks: 5, deltaCostMicroUsd: 1_010_000n }));
    expect(overCost.autoStart).toBe(false);
    expect(overCost.approvalReason).toBe("Needs approval: $1.01 exceeds the $1.00 ceiling");
    const overTasks = new RevisionAutoStartPolicy().evaluate(candidate({ deltaTasks: 6 }));
    expect(overTasks.approvalReason).toBe("Needs approval: 6 tasks exceeds the 5-task ceiling");
    const overWindow = new RevisionAutoStartPolicy().evaluate(candidate({ deltaPlanWindowPpm: 21_000 }));
    expect(overWindow.approvalReason).toBe("Needs approval: 2.1% exceeds the 2% plan-window ceiling");
    expect(DELTA_TASK_CEILING).toBe(5);
    expect(DELTA_COST_CEILING_MICRO_USD).toBe(1_000_000n);
    expect(DELTA_WINDOW_CEILING_PPM).toBe(20_000);
    expect(DAILY_CAP_MICRO_USD).toBe(5_000_000n);
  });

  it("auto-starts five $0.90 tweaks and pauses the sixth at the $5 daily cap", () => {
    const policy = new RevisionAutoStartPolicy();
    const nowMs = 1_700_000_000_000;
    for (let index = 1; index <= 6; index += 1) {
      const decision = policy.evaluate(
        candidate({
          revisionId: `tweak-${index.toString()}`,
          deltaTasks: 1,
          deltaCostMicroUsd: 900_000n,
          nowMs,
        }),
      );
      if (index < 6) {
        expect(decision.autoStart).toBe(true);
        policy.record({ atMs: nowMs, costMicroUsd: 900_000n, windowPpm: 1_000 });
      } else {
        expect(decision.autoStart).toBe(false);
        expect(decision.openPlanPreview).toBe(true);
        expect(decision.approvalReason).toBe("Needs approval: rolling 24h auto-start spend exceeds $5.00");
      }
    }
  });

  it("allows a rolling total of exactly $5.00 and blocks one micro-USD past it", () => {
    const nowMs = 1_700_000_000_000;
    const under = new RevisionAutoStartPolicy();
    under.record({ atMs: nowMs, costMicroUsd: 4_900_000n, windowPpm: 0 });
    expect(under.evaluate(candidate({ deltaCostMicroUsd: 100_000n, nowMs })).autoStart).toBe(true);

    const over = new RevisionAutoStartPolicy();
    over.record({ atMs: nowMs, costMicroUsd: 4_900_000n, windowPpm: 0 });
    const blocked = over.evaluate(candidate({ deltaTasks: 1, deltaCostMicroUsd: 100_001n, nowMs }));
    expect(blocked.autoStart).toBe(false);
    expect(blocked.approvalReason).toBe("Needs approval: rolling 24h auto-start spend exceeds $5.00");
  });

  it("drops spend that is exactly 24 hours old", () => {
    const policy = new RevisionAutoStartPolicy();
    const nowMs = 1_800_000_000_000;
    policy.record({ atMs: nowMs - ROLLING_WINDOW_MS, costMicroUsd: 4_500_000n, windowPpm: 0 });
    const decision = policy.evaluate(candidate({ deltaCostMicroUsd: 900_000n, nowMs }));
    expect(decision.autoStart).toBe(true);
  });

  it("enforces the 10% plan-window cap for subscription connections", () => {
    const nowMs = 1_700_000_000_000;
    const allowed = new RevisionAutoStartPolicy();
    allowed.record({ atMs: nowMs, costMicroUsd: 0n, windowPpm: 90_000 });
    const pass = allowed.evaluate(
      candidate({
        connection: "subscription",
        deltaCostMicroUsd: 0n,
        deltaPlanWindowPpm: 10_000,
        nowMs,
      }),
    );
    expect(pass.autoStart).toBe(true);
    expect(pass.toast?.banner.includes("$")).toBe(false);

    const blockedPolicy = new RevisionAutoStartPolicy();
    blockedPolicy.record({ atMs: nowMs, costMicroUsd: 0n, windowPpm: 90_000 });
    const blocked = blockedPolicy.evaluate(
      candidate({
        connection: "subscription",
        deltaCostMicroUsd: 0n,
        deltaPlanWindowPpm: 10_001,
        nowMs,
      }),
    );
    expect(blocked.autoStart).toBe(false);
    expect(blocked.approvalReason).toBe(
      "Needs approval: rolling 24h auto-start spend exceeds 10% of the plan window",
    );
    expect(blocked.approvalReason?.includes("$")).toBe(false);
  });

  it("blocks every first build and every hard-stop trigger", () => {
    const first = new RevisionAutoStartPolicy().evaluate(
      candidate({ isFirstBuild: true, deltaTasks: 2, deltaCostMicroUsd: 150_000n, deltaPlanWindowPpm: 100 }),
    );
    expect(first.autoStart).toBe(false);
    expect(first.toast).toBeNull();
    expect(first.approvalReason).toBe("Needs approval: first build waits for Start build");

    const stops: { patch: Partial<ReturnType<typeof candidate>>; trigger: string; reason: string }[] = [
      {
        patch: { unresolvedMustAsk: true },
        trigger: "must_ask",
        reason: "Needs approval: unresolved must-ask criterion",
      },
      {
        patch: { unresolvedConflict: true },
        trigger: "conflict",
        reason: "Needs approval: unresolved conflict",
      },
      {
        patch: { breakingContract: true },
        trigger: "breaking_contract",
        reason: "Needs approval: breaking contract change",
      },
      {
        patch: { destructiveMigration: "rename_column", deltaTasks: 2, deltaCostMicroUsd: 300_000n },
        trigger: "destructive_migration",
        reason: "Needs approval: destructive migration",
      },
      {
        patch: { newPackages: ["chart.js"], deltaCostMicroUsd: 200_000n },
        trigger: "new_dependency",
        reason: "Needs approval: adds new package 'chart.js'",
      },
      {
        patch: { externalEffects: ["push"] },
        trigger: "external_effect",
        reason: "Needs approval: external side effect",
      },
    ];
    for (const stop of stops) {
      const decision = new RevisionAutoStartPolicy().evaluate(candidate({ deltaTasks: 1, deltaCostMicroUsd: 100_000n, ...stop.patch }));
      expect(decision.autoStart, stop.trigger).toBe(false);
      expect(decision.openPlanPreview, stop.trigger).toBe(true);
      expect(decision.triggers, stop.trigger).toContain(stop.trigger);
      expect(decision.approvalReason, stop.trigger).toBe(stop.reason);
    }
  });

  it("blocks push, pull request, deploy, live webhook, live email, and secret mutation", () => {
    const effects: ExternalEffect[] = ["push", "pull_request", "deploy", "live_webhook", "live_email", "secret_mutation"];
    for (const effect of effects) {
      const decision = new RevisionAutoStartPolicy().evaluate(candidate({ externalEffects: [effect] }));
      expect(decision.autoStart).toBe(false);
      expect(decision.triggers).toContain("external_effect");
    }
  });

  it("blocks drop, alter narrowing, and data delete migrations", () => {
    for (const kind of ["drop", "alter_narrowing", "data_delete"] as const) {
      const decision = new RevisionAutoStartPolicy().evaluate(candidate({ destructiveMigration: kind }));
      expect(decision.autoStart).toBe(false);
      expect(decision.triggers).toEqual(["destructive_migration"]);
    }
  });

  it("clamps settings to the owner ceilings and honors a tighter cap", () => {
    const policy = new RevisionAutoStartPolicy();
    const loosened = policy.configure({
      deltaTasksCeiling: 9,
      deltaCostCeilingMicroUsd: 10_000_000n,
      deltaWindowCeilingPpm: 50_000,
      dailyCapMicroUsd: 20_000_000n,
      dailyWindowCapPpm: 250_000,
    });
    expect(loosened.ceilingApplied).toBe(true);
    expect(loosened.settings).toEqual({
      deltaTasksCeiling: 5,
      deltaCostCeilingMicroUsd: 1_000_000n,
      deltaWindowCeilingPpm: 20_000,
      dailyCapMicroUsd: 5_000_000n,
      dailyWindowCapPpm: 100_000,
    });
    const tightened = policy.configure({ deltaTasksCeiling: 3 });
    expect(tightened.ceilingApplied).toBe(false);
    expect(policy.evaluate(candidate({ deltaTasks: 3 })).autoStart).toBe(true);
    expect(policy.evaluate(candidate({ deltaTasks: 4 })).autoStart).toBe(false);
    expect(() => policy.configure({ deltaTasksCeiling: -1 })).toThrow(PlanPreviewError);
  });

  it("emits the auto-start banner and a cockpit timeline entry", () => {
    const decision = new RevisionAutoStartPolicy().evaluate(
      candidate({ revisionId: "fix-2", deltaTasks: 2, deltaCostMicroUsd: 220_000n }),
    );
    expect(decision.autoStart).toBe(true);
    expect(decision.toast?.banner).toBe("Auto-starting 2-task fix (~$0.22) — Pause / Review");
    expect(decision.toast?.undoWindowMs).toBe(UNDO_WINDOW_MS);
    expect(decision.toast?.pauseAffordanceMs).toBe(PAUSE_AFFORDANCE_MS);
    expect(decision.toast?.timeline).toMatchObject({
      surface: "build-cockpit",
      kind: "auto_start",
      banner: "Auto-starting 2-task fix (~$0.22) — Pause / Review",
      taskCount: 2,
    });
  });

  it("attaches a before → after delta when approval is required", () => {
    const decision = new RevisionAutoStartPolicy().evaluate(candidate({ newPackages: ["date-fns"], deltaTasks: 3, deltaCostMicroUsd: 850_000n }), {
      before: {
        taskCount: 10,
        costMicroUsd: 1_000_000n,
        windowPpm: 10_000,
        dependencies: [],
        connection: "api",
      },
      after: {
        taskCount: 13,
        costMicroUsd: 1_850_000n,
        windowPpm: 12_000,
        dependencies: ["date-fns"],
        connection: "api",
      },
      reverifiedTaskCount: 1,
    });
    expect(decision.planDelta?.headline).toBe("Before → After Plan Delta");
    expect(decision.planDelta?.taskDeltaLabel).toBe("+3 tasks");
    expect(decision.planDelta?.reverifiedLabel).toBe("1 task re-verified");
    expect(decision.planDelta?.costDeltaLabel).toBe("+$0.85");
    expect(decision.planDelta?.dependencyNotes).toContain("Adds new dependency: date-fns");
    expect(decision.planDelta?.approvalReason).toBe("Needs approval: adds new package 'date-fns'");
  });

  it("does not invent a dollar delta for a subscription plan", () => {
    const delta = new PlanSnapshotDiffer().diff({
      before: { taskCount: 4, costMicroUsd: 0n, windowPpm: 20_000, dependencies: [], connection: "subscription" },
      after: { taskCount: 5, costMicroUsd: 9_000_000n, windowPpm: 32_000, dependencies: [], connection: "subscription" },
      reverifiedTaskCount: 1,
      approvalReason: "Needs approval: unresolved must-ask criterion",
    });
    expect(delta.taskDeltaLabel).toBe("+1 task");
    expect(delta.costDeltaLabel.includes("$")).toBe(false);
    expect(delta.costDeltaLabel).toContain("5-hour allowance");
    expect(delta.lines.join(" ").includes("$")).toBe(false);
  });
});

describe("AutoStartGraceWindow", () => {
  const openedAt = 5_000_000;

  function open(connection: "api" | "subscription" = "api") {
    const toast = createAutoStartToast({
      revisionId: "fix-2",
      connection,
      taskCount: 2,
      costMicroUsd: 220_000n,
      windowPpm: 12_000,
      nowMs: openedAt,
    });
    const window = new AutoStartGraceWindow();
    window.admit(toast);
    return { toast, window };
  }

  it("keeps a 5-second pause and a 10-second undo on the cockpit timeline", () => {
    const { toast, window } = open();
    expect(toast.banner).toBe("Auto-starting 2-task fix (~$0.22) — Pause / Review");
    expect(window.timeline()).toHaveLength(1);
    expect(window.pause(toast.id, openedAt + PAUSE_AFFORDANCE_MS).ok).toBe(true);
    expect(window.status(toast.id)).toBe("paused");
    expect(window.settle(toast.id, openedAt + UNDO_WINDOW_MS + 1).status).toBe("paused");

    const second = open();
    expect(second.window.pause(second.toast.id, openedAt + PAUSE_AFFORDANCE_MS + 1).ok).toBe(false);
    expect(second.window.undo(second.toast.id, openedAt + UNDO_WINDOW_MS).ok).toBe(true);
    expect(second.window.undo(second.toast.id, openedAt + UNDO_WINDOW_MS + 1).ok).toBe(false);

    const third = open();
    expect(third.window.settle(third.toast.id, openedAt + UNDO_WINDOW_MS).status).toBe("pending");
    expect(third.window.settle(third.toast.id, openedAt + UNDO_WINDOW_MS + 1).status).toBe("started");
    expect(third.window.review(third.toast.id, openedAt + 1).ok).toBe(false);
  });

  it("opens Plan Preview from Review and never prices a subscription toast in dollars", () => {
    const { toast, window } = open("subscription");
    expect(toast.banner.includes("$")).toBe(false);
    expect(toast.banner).toContain("5-hour allowance");
    expect(toast.timeline.surface).toBe("build-cockpit");
    const review = window.review(toast.id, openedAt + 1_000);
    expect(review.ok).toBe(true);
    expect(review.openPlanPreview).toBe(true);
    expect(window.settle(toast.id, openedAt + UNDO_WINDOW_MS + 5).status).toBe("reviewing");
  });
});
