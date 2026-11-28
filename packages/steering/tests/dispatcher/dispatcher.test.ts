import { describe, expect, it } from "vitest";
import {
  PAUSE_GRACE_MS,
  StoppedEpochMismatchError,
  TaskControlError,
  USER_PAUSED_REASON,
  createFourRouteSteeringDispatcher,
  type DispatcherSeed,
  type SteeringClause,
  type Sleeper,
} from "../../src/dispatcher/index.js";

function kitchen(seed: DispatcherSeed = {}) {
  return createFourRouteSteeringDispatcher({
    currentWave: 1,
    integrationHead: "refs/harness/integration",
    productionStamp: "prod-v1",
    demoStamp: "demo-v1",
    workers: [
      { id: "A0014", featureId: "F-Orders", taskId: "T-Orders", checkpointRef: "refs/harness/checkpoints/T-Orders/3" },
      { id: "W-Auth", featureId: "F-Auth", taskId: "T-Auth", checkpointRef: "refs/harness/checkpoints/T-Auth/1" },
      { id: "W-Pay", featureId: "F-Pay", taskId: "T-Pay", checkpointRef: "refs/harness/checkpoints/T-Pay/2" },
      { id: "W-Menu", featureId: "F-Menu", taskId: "T-Menu", kind: "foreign", checkpointRef: "refs/harness/checkpoints/T-Menu/1" },
    ],
    tasks: [
      { taskId: "T-Orders", featureId: "F-Orders", title: "Orders list" },
      { taskId: "T-Auth", featureId: "F-Auth", title: "Auth" },
      { taskId: "T-Pay", featureId: "F-Pay", title: "Pay" },
      { taskId: "T-Menu", featureId: "F-Menu", title: "Menu", optional: true },
    ],
    features: [
      { featureId: "F-Orders", title: "Orders", scope: "Orders page", status: "building" },
      { featureId: "F-Auth", title: "Auth", scope: "Auth", status: "building" },
      { featureId: "F-Pay", title: "Pay", scope: "Pay", status: "building" },
      { featureId: "F-Menu", title: "Menu", scope: "Menu", status: "building" },
    ],
    evidence: [
      {
        id: "dec-auth",
        title: "Auth token storage",
        text: "Auth tokens are stored hashed in auth_tokens.",
        featureId: "F-Auth",
        file: "src/auth/tokens.ts",
      },
      {
        id: "note-orders",
        title: "Orders page",
        text: "The Orders page is in progress on T-Orders.",
        featureId: "F-Orders",
        taskId: "T-Orders",
      },
    ],
    impact: { "F-Orders": ["T-Orders"] },
    ...seed,
    workers: seed.workers ?? [
      { id: "A0014", featureId: "F-Orders", taskId: "T-Orders", checkpointRef: "refs/harness/checkpoints/T-Orders/3" },
      { id: "W-Auth", featureId: "F-Auth", taskId: "T-Auth", checkpointRef: "refs/harness/checkpoints/T-Auth/1" },
      { id: "W-Pay", featureId: "F-Pay", taskId: "T-Pay", checkpointRef: "refs/harness/checkpoints/T-Pay/2" },
      { id: "W-Menu", featureId: "F-Menu", taskId: "T-Menu", kind: "foreign", checkpointRef: "refs/harness/checkpoints/T-Menu/1" },
    ],
    features: seed.features ?? [
      { featureId: "F-Orders", title: "Orders", scope: "Orders page", status: "building" },
      { featureId: "F-Auth", title: "Auth", scope: "Auth", status: "building" },
      { featureId: "F-Pay", title: "Pay", scope: "Pay", status: "building" },
      { featureId: "F-Menu", title: "Menu", scope: "Menu", status: "building" },
    ],
    tasks: seed.tasks ?? [
      { taskId: "T-Orders", featureId: "F-Orders", title: "Orders list" },
      { taskId: "T-Auth", featureId: "F-Auth", title: "Auth" },
      { taskId: "T-Pay", featureId: "F-Pay", title: "Pay" },
      { taskId: "T-Menu", featureId: "F-Menu", title: "Menu", optional: true },
    ],
    evidence: seed.evidence ?? [
      {
        id: "dec-auth",
        title: "Auth token storage",
        text: "Auth tokens are stored hashed in auth_tokens.",
        featureId: "F-Auth",
        file: "src/auth/tokens.ts",
      },
      {
        id: "note-orders",
        title: "Orders page",
        text: "The Orders page is in progress on T-Orders.",
        featureId: "F-Orders",
        taskId: "T-Orders",
      },
    ],
    impact: seed.impact ?? { "F-Orders": ["T-Orders"] },
  });
}

describe("four-route steering dispatcher", () => {
  it("answers read-only questions with citations and zero holds", () => {
    const harness = kitchen();
    const before = harness.runtime.fingerprint();
    const worker = harness.dispatcher.dispatchReadOnlyQuery({
      msgSeq: "q-worker",
      text: "What is worker A0014 doing?",
    });
    const auth = harness.dispatcher.dispatchReadOnlyQuery({
      msgSeq: "q-auth",
      text: "Show me how auth tokens are stored",
    });
    const budget = harness.dispatcher.dispatchReadOnlyQuery({
      msgSeq: "q-budget",
      text: "How much budget is left?",
    });
    const orders = harness.dispatcher.dispatchReadOnlyQuery({
      msgSeq: "q-orders",
      text: "How is the Orders page coming along?",
    });

    expect(worker.route).toBe(1);
    expect(worker.receipt.detail.answer).toBe("Worker A0014 is coding T-Orders on F-Orders.");
    expect(worker.receipt.detail.citations.map((item) => item.id)).toEqual(["A0014", "T-Orders"]);
    expect(worker.receipt.detail.llmCalls).toBe(0);
    expect(worker.receipt.detail.latencyMs).toBeLessThan(2_000);
    expect(auth.receipt.detail.answer).toContain("auth_tokens");
    expect(auth.receipt.detail.citations.some((item) => item.kind === "file" && item.id === "src/auth/tokens.ts")).toBe(true);
    expect(budget.receipt.detail.answer).toBe("$9.00 left of $10.00 spend cap · 10% of the window used.");
    expect(budget.receipt.detail.citations[0]?.id).toBe("budget-ledger");
    expect(orders.receipt.detail.answer).toContain("Orders page");
    expect(harness.holds.listActiveHolds()).toEqual([]);
    expect(harness.runtime.listWorkers().every((item) => item.state === "running")).toBe(true);
    expect(harness.runtime.fingerprint()).toBe(before);
    expect(harness.dispatcher.trace.askOwnerCalls).toBe(4);
    expect(harness.dispatcher.trace.llmCalls).toBe(0);
    expect(harness.telemetry.events().every((event) => event.route === 1 && event.latencyMs < 2_000)).toBe(true);
  });

  it("places surgical holds and auto-starts a tiny compatible revision", () => {
    const harness = kitchen();
    const result = harness.dispatcher.dispatchExistingFeatureChange({
      msgSeq: "edit-tiny",
      targetId: "F-Orders",
      edit: {
        targetId: "F-Orders",
        beforeText: "Orders page",
        afterText: "Orders page shows the ticket number",
        requestedClass: "compatible",
        estimatedCostMicroUsd: 400_000n,
        estimatedWindowPpm: 10_000,
      },
    });
    expect(result.route).toBe(2);
    expect(result.receipt.detail.autoStarted).toBe(true);
    expect(result.receipt.detail.undoable).toBe(true);
    expect(result.receipt.detail.planDeltaPreview).toBe(false);
    expect(result.receipt.pill).toBe("Updated 'Orders' · undoable");
    expect(result.receipt.detail.holdsAdded).toEqual(["T-Orders"]);
    expect(harness.holds.listActiveHolds().map((hold) => hold.reason)).toEqual(["requirement_change"]);
    expect(harness.runtime.workers.get("A0014")?.state).toBe("held");
    expect(harness.runtime.workers.get("W-Auth")?.state).toBe("running");
    expect(harness.runtime.workers.get("W-Pay")?.state).toBe("running");
    expect(harness.runtime.workers.get("W-Menu")?.state).toBe("running");
    expect(harness.dispatcher.trace.classifierCalls).toBe(1);
    expect(harness.dispatcher.trace.walkerCalls).toBe(1);
    expect(harness.dispatcher.trace.propagatorCalls).toBe(1);
    expect(harness.dispatcher.trace.policyCalls).toBe(1);
    expect(result.receipt.detail.llmCalls).toBe(0);
  });

  it("pauses a large or breaking revision at plan delta preview", () => {
    const large = kitchen({
      impact: { "F-Orders": ["T1", "T2", "T3", "T4", "T5", "T6"] },
    });
    const preview = large.dispatcher.dispatchExistingFeatureChange({
      msgSeq: "edit-large",
      targetId: "F-Orders",
      edit: {
        targetId: "F-Orders",
        beforeText: "Orders page",
        afterText: "Orders page gains six new tasks",
        estimatedCostMicroUsd: 400_000n,
        estimatedWindowPpm: 1_000,
      },
    });
    expect(preview.receipt.detail.planDeltaPreview).toBe(true);
    expect(preview.receipt.detail.autoStarted).toBe(false);
    expect(preview.receipt.pill).toBe("Paused at Plan Delta Preview for 'Orders'");
    expect(preview.receipt.detail.holdsAdded).toHaveLength(6);
    expect(large.runtime.workers.get("W-Auth")?.state).toBe("running");

    const breaking = kitchen();
    const blocked = breaking.dispatcher.dispatchExistingFeatureChange({
      msgSeq: "edit-break",
      targetId: "F-Orders",
      edit: {
        targetId: "F-Orders",
        beforeText: "cutoff 11:00",
        afterText: "cutoff 11:00 → 10:00",
        requestedClass: "cosmetic",
      },
    });
    expect(blocked.receipt.detail.changeClass).toBe("breaking");
    expect(blocked.receipt.detail.planDeltaPreview).toBe(true);
    expect(blocked.receipt.detail.autoStarted).toBe(false);
  });

  it("revives a deferred feature id and keeps settled answers", () => {
    const harness = kitchen({
      features: [
        { featureId: "F-Orders", title: "Orders", scope: "Orders page", status: "building" },
        { featureId: "F-Auth", title: "Auth", scope: "Auth", status: "building" },
        { featureId: "F-Pay", title: "Pay", scope: "Pay", status: "building" },
        { featureId: "F-Menu", title: "Menu", scope: "Menu", status: "building" },
        {
          featureId: "F-PdfExport",
          title: "PDF Export",
          slug: "pdf-export",
          status: "deferred",
          scope: "Deferred in plan preview",
          settledAnswers: [{ id: "ans-landscape", text: "Use landscape" }],
        },
        {
          featureId: "F-CsvExport",
          title: "CSV Export",
          slug: "csv-export",
          status: "deferred",
          scope: "Weekly CSV export for finance",
        },
      ],
    });
    const pdf = harness.dispatcher.dispatchNewFeatureAddition({
      msgSeq: "add-pdf",
      text: "Add PDF export",
    });
    expect(pdf.receipt.pill).toBe("Reviving deferred feature F-PdfExport");
    expect(pdf.receipt.detail.featureId).toBe("F-PdfExport");
    expect(pdf.receipt.detail.preservedAnswerIds).toEqual(["ans-landscape"]);
    expect(harness.graph.getFeature("F-PdfExport")?.settledAnswers).toEqual([{ id: "ans-landscape", text: "Use landscape" }]);
    expect(harness.graph.listFeatures().some((feature) => feature.featureId.endsWith("-2"))).toBe(false);
    expect(harness.discovery.listSessions()[0]?.haltUnrelatedWorkers).toBe(false);
    expect(harness.runtime.listWorkers().every((worker) => worker.state === "running")).toBe(true);

    const csv = harness.dispatcher.dispatchNewFeatureAddition({
      msgSeq: "add-csv",
      text: "Add weekly CSV export for finance",
    });
    expect(csv.receipt.pill).toBe("Reviving deferred feature F-CsvExport");
    expect(csv.receipt.detail.featureId).toBe("F-CsvExport");
  });

  it("opens mini-discovery for a new feature without pausing wave-1 workers", () => {
    const harness = kitchen();
    const added = harness.dispatcher.dispatchNewFeatureAddition({
      msgSeq: "add-analytics",
      text: "Add a brand new Analytics Dashboard",
      openCriteria: ["Which metrics appear on the dashboard?"],
    });
    expect(added.receipt.pill).toBe("Added 'Analytics Dashboard' to mini-discovery — build continuing");
    expect(added.receipt.detail.featureId).toBe("F-AnalyticsDashboard");
    expect(added.receipt.detail.scheduledWave).toBe(2);
    expect(added.receipt.detail.discoverySessionId).toBe("disc-F-AnalyticsDashboard");
    expect(harness.runtime.listWorkers().every((worker) => worker.state === "running")).toBe(true);
    expect(harness.holds.listActiveHolds()).toEqual([]);

    const active = kitchen({ completelyDisjoint: undefined });
    const joined = active.dispatcher.dispatchNewFeatureAddition({
      msgSeq: "add-dark",
      text: "Also add a dark mode toggle",
      completelyDisjoint: true,
      estimatedCostMicroUsd: 200_000n,
      estimatedWindowPpm: 2_000,
    });
    expect(joined.receipt.pill).toBe("Added 'Dark Mode Toggle' to mini-discovery — build continuing");
    expect(joined.receipt.detail.scheduledWave).toBe(1);
    expect(joined.receipt.detail.featureId).not.toMatch(/-2$/);
  });

  it("warns before starting a feature that exceeds the spend cap", () => {
    const harness = kitchen({
      budget: {
        spentMicroUsd: 9_500_000n,
        capMicroUsd: 10_000_000n,
        windowUsedPpm: 1_000,
        windowCapPpm: 100_000,
      },
    });
    const before = harness.runtime.listWorkers().map((worker) => worker.state);
    const result = harness.dispatcher.dispatchNewFeatureAddition({
      msgSeq: "add-over",
      text: "Add a brand new Analytics Dashboard",
      estimatedCostMicroUsd: 1_000_000n,
    });
    expect(result.receipt.detail.warning).toBe("Adding 'Analytics Dashboard' exceeds the active spend cap");
    expect(result.receipt.detail.discoverySessionId).toBeNull();
    expect(harness.graph.getFeature("F-AnalyticsDashboard")).toBeNull();
    expect(harness.runtime.listWorkers().map((worker) => worker.state)).toEqual(before);
  });

  it("runs direct controls with zero model calls", async () => {
    const delays: number[] = [];
    const sleeper: Sleeper = {
      async sleep(ms: number): Promise<void> {
        delays.push(ms);
      },
    };
    const harness = kitchen({ sleeper });
    const pauseFeature = await harness.dispatcher.dispatchExecutionControl({
      msgSeq: "pause-orders",
      control: "pause_feature",
      featureId: "F-Orders",
      featureTitle: "Orders",
    });
    expect(pauseFeature.receipt.pill).toBe("Paused only 'Orders' (1 worker held; 3 others still running)");
    expect(pauseFeature.receipt.wrongRouteLabel).toBe("Wrong route?");
    expect(harness.holds.listActiveHolds("T-Orders").map((hold) => hold.reason)).toEqual([USER_PAUSED_REASON]);
    expect(harness.runtime.workers.get("W-Auth")?.state).toBe("running");
    expect(pauseFeature.receipt.detail.llmCalls).toBe(0);

    const pauseBuild = await harness.dispatcher.dispatchExecutionControl({
      msgSeq: "pause-build",
      control: "pause_build",
    });
    expect(delays).toEqual([PAUSE_GRACE_MS]);
    expect(pauseBuild.receipt.pill).toBe("Paused build · finishing current steps");
    expect(harness.runtime.projectRuntime().controlState).toBe("PAUSED");
    expect(harness.runtime.projectRuntime().claimNewTasks).toBe(false);
    expect(harness.runtime.workers.get("W-Auth")?.state).toBe("interrupted");

    const resumed = await harness.dispatcher.dispatchExecutionControl({ msgSeq: "resume", control: "resume" });
    expect(resumed.receipt.detail.control).toBe("resume");
    expect(harness.runtime.projectRuntime().controlState).toBe("RUNNING");
    expect(harness.holds.listActiveHolds("T-Orders")).toHaveLength(1);

    const cancelled = await harness.dispatcher.dispatchExecutionControl({
      msgSeq: "cancel",
      control: "cancel_task",
      taskId: "T-Pay",
    });
    expect(cancelled.receipt.pill).toBe("Cancelled T-Pay");
    expect(harness.runtime.tasks.get("T-Pay")?.state).toBe("CANCELLED");

    const retried = await harness.dispatcher.dispatchExecutionControl({
      msgSeq: "retry",
      control: "retry_task",
      taskId: "T-Pay",
    });
    expect(retried.receipt.pill).toContain("T-Pay");
    expect(harness.runtime.tasks.get("T-Pay")?.attempt).toBe(2);
    expect(harness.runtime.workers.get("W-Pay")?.checkpointRef).toBe("refs/harness/checkpoints/T-Pay/2");

    const preset = await harness.dispatcher.dispatchExecutionControl({
      msgSeq: "preset",
      control: "switch_preset",
      presetId: "junior",
    });
    expect(preset.receipt.pill).toBe("Switched preset to junior");
    expect(harness.runtime.presetId).toBe("junior");

    const skipped = await harness.dispatcher.dispatchExecutionControl({
      msgSeq: "skip",
      control: "skip_optional_task",
      taskId: "T-Menu",
    });
    expect(skipped.receipt.pill).toBe("Skipped optional T-Menu");
    expect(harness.runtime.tasks.get("T-Menu")?.state).toBe("SKIPPED");
    await expect(
      harness.dispatcher.dispatchExecutionControl({ msgSeq: "skip-required", control: "skip_optional_task", taskId: "T-Auth" }),
    ).rejects.toBeInstanceOf(TaskControlError);

    const stopped = await harness.dispatcher.dispatchExecutionControl({
      msgSeq: "stop",
      control: "stop_now",
      interruptGraceMs: 0,
    });
    expect(stopped.receipt.detail.stateFlipMs).toBeLessThan(100);
    expect(stopped.receipt.detail.llmCalls).toBe(0);
    expect(stopped.receipt.detail.latencyMs).toBeLessThan(100);
    expect(harness.runtime.projectRuntime().state).toBe("STOPPED");
    expect(harness.runtime.projectRuntime().controlEpoch).toBeGreaterThan(1);
    expect(harness.nativeWorkers.interrupted()).toContain("A0014");
    expect(harness.foreignAdapters.interrupted()).toContain("W-Menu");
    expect(harness.runtime.workers.get("A0014")?.checkpointRef).toBe("refs/harness/checkpoints/T-Orders/3");
    expect(harness.telemetry.events().some((event) => event.kind === "stop" && event.latencyMs < 100)).toBe(true);
  });

  it("rejects a stale candidate merge when STOP wins the race", async () => {
    const harness = kitchen();
    const merged = await harness.stopController.acceptCandidate({
      workerId: "W-1",
      featureId: "F-Orders",
      taskId: "T-Orders",
      commitRef: "commit-before-stop",
      artifactRef: "artifact-before",
    });
    expect(merged.integrationHead).toBe("commit-before-stop");

    const fresh = kitchen();
    let release: (() => void) | undefined;
    let markStarted: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    fresh.stopController.armCommitBarrier(async () => {
      markStarted?.();
      await gate;
    });
    const pending = fresh.stopController.acceptCandidate({
      workerId: "W-2",
      featureId: "F-Orders",
      taskId: "T-Orders",
      commitRef: "commit-w2",
      artifactRef: "artifact-w2",
    });
    await started;
    await fresh.dispatcher.dispatchExecutionControl({ msgSeq: "race-stop", control: "stop_now", interruptGraceMs: 0 });
    release?.();
    await expect(pending).rejects.toBeInstanceOf(StoppedEpochMismatchError);
    expect(fresh.runtime.integrationHead).toBe("refs/harness/integration");
    expect(fresh.runtime.featureHeads.get("F-Orders")).toBe("refs/harness/f/F-Orders");
    expect(fresh.stopController.submissionPending()[0]).toMatchObject({
      workerId: "W-2",
      artifactRef: "artifact-w2",
      code: "STOPPED_EPOCH_MISMATCH",
    });

    const staleEpoch = fresh.runtime.controlEpoch - 1;
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
    await expect(
      fresh.stopController.acceptCandidate({
        workerId: "W-2",
        featureId: "F-Orders",
        taskId: "T-Orders",
        commitRef: "commit-late",
        artifactRef: "artifact-late",
        observedEpoch: staleEpoch,
      }),
    ).rejects.toBeInstanceOf(StoppedEpochMismatchError);
    expect(fresh.runtime.integrationHead).toBe("refs/harness/integration");
    expect(fresh.runtime.featureHeads.get("F-Orders")).toBe("refs/harness/f/F-Orders");
  });

  it("reverses a new-feature stub back onto the existing feature", () => {
    const harness = kitchen();
    const added = harness.dispatcher.dispatchNewFeatureAddition({
      msgSeq: "msg-print",
      text: "Add a print preview widget",
    });
    expect(added.route).toBe(3);
    const featureId = added.receipt.detail.featureId;
    expect(featureId).toBeTruthy();
    const reversed = added.receipt.wrongRoute("F-Orders");
    expect(reversed.route).toBe(2);
    expect(reversed.msgSeq).toBe("msg-print");
    expect(reversed.receipt.detail.featureId).toBe("F-Orders");
    expect(harness.graph.getFeature(featureId ?? "")).toMatchObject({ status: "archived", scope: "" });
    expect(harness.telemetry.correctionRate()).toBeGreaterThan(0);
    expect(harness.holds.listActiveHolds().every((hold) => hold.taskId === "T-Orders")).toBe(true);
  });

  it("executes compound clauses in stop, answer, edit, add, query order", () => {
    const harness = kitchen();
    const clauses: SteeringClause[] = [
      { id: "c-query", kind: "query", text: "How much budget is left?", targetId: null, index: 4 },
      { id: "c-add", kind: "add", text: "Add a brand new Analytics Dashboard", targetId: null, index: 3 },
      { id: "c-edit", kind: "edit", text: "Show the ticket number", targetId: "F-Orders", index: 2 },
      { id: "c-answer", kind: "answer", text: "What is worker A0014 doing?", targetId: null, index: 1 },
      { id: "c-stop", kind: "stop", text: "stop", targetId: null, index: 0 },
    ];
    const results = harness.dispatcher.dispatchClauses(clauses);
    expect(harness.clauses.executedKinds).toEqual(["stop", "answer", "edit", "add", "query"]);
    expect(results.map((result) => result.route)).toEqual([4, 1, 2, 3, 1]);
    expect(results[0]?.receipt.detail.control).toBe("stop_now");
    expect(results[2]?.receipt.pill).toBe("Ignored after STOP · build is stopped");
    expect(results[3]?.receipt.pill).toBe("Ignored after STOP · build is stopped");
    expect(harness.runtime.projectRuntime().state).toBe("STOPPED");
  });
});
