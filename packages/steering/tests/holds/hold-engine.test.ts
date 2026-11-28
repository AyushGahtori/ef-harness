import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  AdditiveVsContradictoryResumer,
  HoldModeClassifier,
  LocalCandidateAcceptanceTx,
  LocalHoldSurfaces,
  LocalInbox,
  LocalReverseImpactWalker,
  LocalWorkerSession,
  MultiInterpretationHoldEngine,
  UNVERIFIED_DRAFT_LABEL,
  ambiguousHoldExplanation,
  holdKey,
  kernelReasonFor,
  openHoldDatabase,
} from "../../src/holds/index.js";
import type { AlternateReading, AmbiguousMidBuildMessage, TaskSnapshot, WipFile } from "../../src/holds/index.js";

const TEN_MINUTES_MS = 10 * 60 * 1000;

function task(overrides: Partial<TaskSnapshot> & Pick<TaskSnapshot, "taskId" | "featureId">): TaskSnapshot {
  const base: TaskSnapshot = {
    taskId: overrides.taskId,
    featureId: overrides.featureId,
    label: overrides.label ?? overrides.taskId,
    progress: overrides.progress ?? 0.2,
    state: overrides.state ?? "CODING",
    sliceSha256: overrides.sliceSha256 ?? `sha-${overrides.taskId}`,
    briefText: overrides.briefText ?? `${overrides.taskId} brief`,
    requirements: overrides.requirements ?? [`req-${overrides.taskId}`],
    baseCommit: overrides.baseCommit ?? `base-${overrides.featureId}`,
    sessionRef: overrides.sessionRef ?? `session-${overrides.taskId}`,
    step: overrides.step ?? 4,
    wipFiles: overrides.wipFiles ?? [],
    criticalPath: overrides.criticalPath ?? false,
  };
  return base;
}

function reading(overrides: Partial<AlternateReading> & Pick<AlternateReading, "id" | "featureId" | "label">): AlternateReading {
  return {
    id: overrides.id,
    featureId: overrides.featureId,
    label: overrides.label,
    targetNodeIds: overrides.targetNodeIds ?? [overrides.featureId],
    changeKind: overrides.changeKind ?? "additive",
    deltaText: overrides.deltaText ?? `Update ${overrides.label}.`,
    ...(overrides.replacementBrief !== undefined ? { replacementBrief: overrides.replacementBrief } : {}),
    ...(overrides.contradictedTokens !== undefined ? { contradictedTokens: overrides.contradictedTokens } : {}),
  };
}

function message(
  readings: readonly AlternateReading[],
  overrides?: Partial<Pick<AmbiguousMidBuildMessage, "messageId" | "text" | "subject">>,
): AmbiguousMidBuildMessage {
  return {
    messageId: overrides?.messageId ?? "104",
    text: overrides?.text ?? "Make the export include timestamps",
    subject: overrides?.subject ?? "export timestamps",
    alternateReadings: readings,
  };
}

function harness(edges: ReadonlyMap<string, readonly string[]>, clock?: () => number) {
  const db = openHoldDatabase();
  const walker = new LocalReverseImpactWalker(edges);
  const worker = new LocalWorkerSession();
  const acceptance = new LocalCandidateAcceptanceTx();
  const inbox = new LocalInbox();
  const surfaces = new LocalHoldSurfaces();
  const engine = new MultiInterpretationHoldEngine({
    db,
    walker,
    worker,
    acceptance,
    inbox,
    surfaces,
    ...(clock ? { clock } : {}),
  });
  return { db, walker, worker, acceptance, inbox, surfaces, engine };
}

function kitchenEdges(): Map<string, readonly string[]> {
  return new Map<string, readonly string[]>([
    ["F-Orders", ["T-1"]],
    ["F-Reports", ["T-2"]],
  ]);
}

function kitchenCatalog(): TaskSnapshot[] {
  return [
    task({
      taskId: "T-1",
      featureId: "F-Orders",
      label: "Orders export",
      progress: 0.2,
      state: "CODING",
      briefText: "Export orders.",
      requirements: ["export orders"],
      baseCommit: "sha-orders",
      sessionRef: "sess-T-1",
      criticalPath: true,
      wipFiles: [{ path: "orders.ts", content: "export const orders = []" }],
    }),
    task({
      taskId: "T-2",
      featureId: "F-Reports",
      label: "Reports export",
      progress: 0.95,
      state: "VERIFYING",
      briefText: "Export reports.",
      requirements: ["export reports"],
      baseCommit: "sha-reports",
      sessionRef: "sess-T-2",
      wipFiles: [{ path: "reports.ts", content: "export const reports = []" }],
    }),
    task({
      taskId: "T-3",
      featureId: "F-Auth",
      label: "Auth",
      progress: 0.5,
      state: "CODING",
      briefText: "Authenticate requests.",
      requirements: ["auth"],
      baseCommit: "sha-auth",
      sessionRef: "sess-T-3",
    }),
  ];
}

function kitchenMessage(): AmbiguousMidBuildMessage {
  return message([
    reading({
      id: "R-orders",
      featureId: "F-Orders",
      label: "Orders",
      deltaText: "Include timestamps in the export.",
    }),
    reading({
      id: "R-reports",
      featureId: "F-Reports",
      label: "Reports",
      deltaText: "Include timestamps in the export.",
    }),
  ]);
}

describe("MultiInterpretationHoldEngine", () => {
  it("holds only the union of every reading and leaves F-Auth running", () => {
    const rig = harness(kitchenEdges());
    const placed = rig.engine.holdAmbiguousMessage(kitchenMessage(), kitchenCatalog());
    const explanation = ambiguousHoldExplanation("export timestamps", ["Orders", "Reports"]);

    expect(rig.walker.calls).toEqual([["F-Orders"], ["F-Reports"]]);
    expect(placed.walkerCalls).toBe(2);
    expect(placed.affectedTaskIds).toEqual(["T-1", "T-2"]);
    expect(placed.untouchedTaskIds).toEqual(["T-3"]);
    expect(placed.card.cardCount).toBe(1);
    expect(rig.inbox.cards).toHaveLength(1);
    expect(placed.placements.map((item) => [item.taskId, item.mode, item.quarantine])).toEqual([
      ["T-1", "HARD_HOLD", false],
      ["T-2", "SOFT_HOLD", true],
    ]);
    expect(explanation).toBe("Held: waiting to confirm whether 'export timestamps' applies to Orders or Reports");
    expect(placed.placements.every((item) => item.explanation === explanation)).toBe(true);
    expect(rig.worker.interrupts.map((item) => item.taskId)).toEqual(["T-1"]);
    expect(rig.worker.continued.map((item) => item.taskId)).toEqual(["T-2"]);
    expect(rig.worker.interrupts[0]?.step).toBe(4);
    expect(rig.engine.mergeDecision("T-1")).toEqual({ taskId: "T-1", allowed: false, reason: "held" });
    expect(rig.engine.mergeDecision("T-2")).toEqual({ taskId: "T-2", allowed: false, reason: "held" });
    expect(rig.engine.mergeDecision("T-3")).toEqual({ taskId: "T-3", allowed: true, reason: "clear" });
    expect(rig.engine.activeHoldCount("T-3")).toBe(0);
    expect(placed.transaction).toEqual(["BEGIN IMMEDIATE", "COMMIT"]);

    const visible = rig.engine.visibility();
    expect(visible.map((entry) => entry.explanation)).toEqual([explanation, explanation]);
    expect(visible.every((entry) => entry.board && entry.inspector)).toBe(true);
    expect(rig.surfaces.publications[0]?.map((entry) => entry.explanation)).toEqual([explanation, explanation]);
  });

  it("rejects a message with fewer than two readings before walking impact", () => {
    const rig = harness(kitchenEdges());
    const single = message([reading({ id: "R-orders", featureId: "F-Orders", label: "Orders" })]);
    expect(() => rig.engine.holdAmbiguousMessage(single, kitchenCatalog())).toThrow(/k >= 2/);
    expect(rig.walker.calls).toHaveLength(0);
    expect(rig.engine.store.countAllHolds()).toBe(0);
  });

  it("quarantines a verifying task and lands it in under a second when the other reading wins", () => {
    const rig = harness(kitchenEdges());
    rig.engine.holdAmbiguousMessage(kitchenMessage(), kitchenCatalog());
    rig.engine.noteVerificationFinished("T-2", {
      commitSha: "commit-reports",
      baseCommit: "sha-reports",
      attempt: "attempt-T-2",
    });

    expect(rig.engine.mergeDecision("T-2")).toEqual({ taskId: "T-2", allowed: false, reason: "held" });
    expect(rig.engine.store.submissionPending("T-2")).toBe(true);
    expect(rig.acceptance.landed).toHaveLength(0);
    expect(rig.engine.store.loadCandidate("T-2")?.status).toBe("submission_pending");

    const turnsBefore = rig.worker.modelTurns;
    const resolved = rig.engine.resolveClarification({
      messageId: "104",
      reply: "I meant F-Orders",
    });
    const reports = resolved.tasks.find((item) => item.taskId === "T-2");
    const orders = resolved.tasks.find((item) => item.taskId === "T-1");

    expect(reports).toMatchObject({
      delta: "none",
      session: "unchanged",
      quarantine: "landed",
      landedCommitSha: "commit-reports",
      sessionRef: "sess-T-2",
      workerModelTurn: false,
    });
    expect(reports?.elapsedMs).not.toBeNull();
    expect(reports?.elapsedMs ?? 1_000).toBeLessThan(1_000);
    expect(orders).toMatchObject({
      delta: "additive",
      session: "warm_note",
      quarantine: "none",
      sessionRef: "sess-T-1",
    });
    expect(orders?.steeringNote?.text).toContain("Include timestamps in the export.");
    expect(orders?.steeringNote?.signature).toBe(sha256(orders?.steeringNote?.text ?? ""));
    expect(rig.worker.modelTurns).toBe(turnsBefore);
    expect(rig.acceptance.landed).toEqual([
      { taskId: "T-2", commitSha: "commit-reports", baseHead: "sha-reports", reverified: false },
    ]);
    expect(rig.engine.mergeDecision("T-2")).toEqual({ taskId: "T-2", allowed: true, reason: "clear" });
    expect(rig.engine.activeHoldCount("T-1")).toBe(0);
    expect(rig.engine.activeHoldCount("T-3")).toBe(0);
  });

  it("reverifies a quarantined candidate when the feature head moved", () => {
    const rig = harness(kitchenEdges());
    rig.engine.holdAmbiguousMessage(kitchenMessage(), kitchenCatalog());
    rig.engine.noteVerificationFinished("T-2", {
      commitSha: "commit-reports",
      baseCommit: "sha-reports",
      attempt: "attempt-T-2",
    });
    rig.engine.advanceFeatureHead("F-Reports", "sha-reports-next");

    const resolved = rig.engine.resolveClarification({ messageId: "104", reply: "I meant F-Orders" });
    const reports = resolved.tasks.find((item) => item.taskId === "T-2");
    expect(rig.acceptance.reverified).toEqual([
      {
        taskId: "T-2",
        commitSha: "commit-reports",
        fromBase: "sha-reports",
        toHead: "sha-reports-next",
      },
    ]);
    expect(reports?.quarantine).toBe("reverified");
    expect(rig.acceptance.landed).toEqual([
      { taskId: "T-2", commitSha: "commit-reports", baseHead: "sha-reports-next", reverified: true },
    ]);
  });

  it("does not land a stale quarantined commit when re-verify fails", () => {
    const rig = harness(kitchenEdges());
    rig.acceptance.reverifyResult = { ok: false, commitSha: "commit-reports" };
    rig.engine.holdAmbiguousMessage(kitchenMessage(), kitchenCatalog());
    rig.engine.noteVerificationFinished("T-2", {
      commitSha: "commit-reports",
      baseCommit: "sha-reports",
      attempt: "attempt-T-2",
    });
    rig.engine.advanceFeatureHead("F-Reports", "sha-reports-next");
    const resolved = rig.engine.resolveClarification({ messageId: "104", reply: "I meant F-Orders" });
    expect(resolved.tasks.find((item) => item.taskId === "T-2")?.quarantine).toBe("blocked_drift");
    expect(rig.acceptance.landed).toHaveLength(0);
    expect(rig.engine.mergeDecision("T-2").allowed).toBe(false);
    expect(rig.engine.store.loadCandidate("T-2")?.status).toBe("reverify_failed");
  });

  it("keeps a second hold reason after the ambiguous message clears", () => {
    const rig = harness(kitchenEdges());
    rig.engine.holdAmbiguousMessage(kitchenMessage(), kitchenCatalog());
    rig.engine.stack.place({
      taskId: "T-1",
      featureId: "F-Orders",
      reasonType: "user_paused",
      reasonRefId: "feature",
      mode: "HARD_HOLD",
      quarantine: false,
      explanation: "Held: you paused this feature",
      messageId: "",
      createdAt: 5,
    });
    expect(kernelReasonFor("ambiguous_message")).toBe("requirement_change");
    expect(kernelReasonFor("user_paused")).toBe("user_pause");
    expect(holdKey("ambiguous_message", "104")).toBe("ambiguous_message_104");
    expect(holdKey("user_paused", "feature")).toBe("user_paused_feature");

    const resolved = rig.engine.resolveClarification({ messageId: "104", reply: "I meant F-Reports" });
    const orders = resolved.tasks.find((item) => item.taskId === "T-1");
    expect(orders).toMatchObject({ holdCount: 1, session: "still_held" });
    expect(rig.engine.stack.list("T-1").map((hold) => hold.holdKey)).toEqual(["user_paused_feature"]);
    expect(rig.engine.activeHoldCount("T-1")).toBe(1);
    expect(rig.worker.notes.some((note) => note.taskId === "T-1")).toBe(false);
    expect(rig.worker.existingResumes.some((resume) => resume.taskId === "T-1")).toBe(false);
    expect(rig.worker.freshSessions.some((session) => session.taskId === "T-1")).toBe(false);
    expect(rig.worker.notes.some((note) => note.taskId === "T-2")).toBe(true);
    expect(rig.engine.mergeDecision("T-1").allowed).toBe(false);
  });

  it("resumes a warm session for an additive clarification", () => {
    const edges = new Map<string, readonly string[]>([
      ["F-Tooltip", ["T-7"]],
      ["F-Other", ["T-8"]],
    ]);
    const rig = harness(edges);
    const wip: WipFile[] = [{ path: "tooltip.tsx", content: "export function tooltip() {}" }];
    const catalog = [
      task({
        taskId: "T-7",
        featureId: "F-Tooltip",
        progress: 0.4,
        state: "CODING",
        briefText: "Show the order tooltip.",
        requirements: ["tooltip"],
        sessionRef: "sess-T-7",
        wipFiles: wip,
      }),
      task({ taskId: "T-8", featureId: "F-Other", progress: 0.95, state: "VERIFYING", sessionRef: "sess-T-8" }),
    ];
    rig.engine.holdAmbiguousMessage(
      message(
        [
          reading({
            id: "R-tip",
            featureId: "F-Tooltip",
            label: "Tooltip",
            deltaText: "Also add an aria-label.",
          }),
          reading({ id: "R-other", featureId: "F-Other", label: "Other", deltaText: "Leave it." }),
        ],
        { messageId: "88", subject: "tooltip copy", text: "Also add an aria-label" },
      ),
      catalog,
    );
    const resolved = rig.engine.resolveClarification({ messageId: "88", reply: "I meant F-Tooltip" });
    const tooltip = resolved.tasks.find((item) => item.taskId === "T-7");
    expect(tooltip).toMatchObject({
      delta: "additive",
      session: "warm_note",
      sessionRef: "sess-T-7",
    });
    expect(tooltip?.steeringNote?.text).toContain("Also add an aria-label.");
    expect(tooltip?.steeringNote?.signature).toBe(sha256(tooltip?.steeringNote?.text ?? ""));
    expect(rig.worker.notes[0]?.wipFiles).toEqual(wip);
    expect(rig.worker.freshSessions).toHaveLength(0);
    expect(rig.worker.sessions.get("sess-T-7")?.lines.join("\n")).toContain("Also add an aria-label.");
  });

  it("reconstructs a fresh session for a contradictory spec change and keeps salvageable WIP labeled", () => {
    const edges = new Map<string, readonly string[]>([["F-Orders", ["T-6"]]]);
    const rig = harness(edges);
    const catalog = [
      task({
        taskId: "T-6",
        featureId: "F-Orders",
        progress: 0.3,
        state: "CODING",
        briefText: "Persist orders in SQLite.",
        requirements: ["sqlite"],
        sessionRef: "sess-sqlite",
        wipFiles: [
          { path: "db.ts", content: "open sqlite database" },
          { path: "ui.css", content: "color: navy" },
        ],
      }),
    ];
    rig.engine.holdAmbiguousMessage(
      message([
        reading({
          id: "R-pg",
          featureId: "F-Orders",
          label: "Orders",
          changeKind: "contradictory",
          deltaText: "Switch SQLite to Postgres.",
          replacementBrief: "Persist orders in Postgres.",
          contradictedTokens: ["sqlite"],
        }),
        reading({
          id: "R-decoy",
          featureId: "F-Nobody",
          label: "Nobody",
          deltaText: "No task.",
          targetNodeIds: ["F-Nobody"],
        }),
      ]),
      catalog,
    );
    const before = [...(rig.worker.sessions.get("sess-sqlite")?.lines ?? [])];
    expect(before).toEqual(["Persist orders in SQLite."]);
    const resolved = rig.engine.resolveClarification({ messageId: "104", reply: "I meant F-Orders" });
    const taskResolution = resolved.tasks.find((item) => item.taskId === "T-6");
    expect(taskResolution).toMatchObject({
      delta: "contradictory",
      session: "fresh",
      sessionRef: "sess-sqlite:fresh:1",
    });
    expect(taskResolution?.discardedWip).toEqual(["db.ts"]);
    expect(taskResolution?.salvagedWip).toEqual([{ path: "ui.css", label: UNVERIFIED_DRAFT_LABEL }]);
    expect(rig.worker.sessions.get("sess-sqlite")?.lines).toEqual(before);
    expect(rig.worker.freshSessions[0]?.previousSessionAppended).toBe(false);
    expect(rig.worker.freshSessions[0]?.lines.join("\n")).toContain("Persist orders in Postgres.");
    expect(rig.worker.freshSessions[0]?.lines.join("\n")).toContain(UNVERIFIED_DRAFT_LABEL);
    expect(rig.worker.notes).toHaveLength(0);
    expect(before.join("\n")).not.toContain("Postgres");
  });

  it("discards a stale quarantine and updates both tasks when the reply applies to both readings", () => {
    const rig = harness(kitchenEdges());
    rig.engine.holdAmbiguousMessage(kitchenMessage(), kitchenCatalog());
    rig.engine.noteVerificationFinished("T-2", {
      commitSha: "commit-reports",
      baseCommit: "sha-reports",
      attempt: "attempt-T-2",
    });
    const resolved = rig.engine.resolveClarification({
      messageId: "104",
      reply: "Actually, apply it to BOTH Orders AND Reports",
    });
    expect(resolved.selectedReadingIds).toEqual(["R-orders", "R-reports"]);
    expect(resolved.tasks.find((item) => item.taskId === "T-1")).toMatchObject({
      delta: "additive",
      session: "warm_note",
    });
    expect(resolved.tasks.find((item) => item.taskId === "T-2")).toMatchObject({
      delta: "additive",
      session: "warm_note",
      quarantine: "discarded",
    });
    expect(rig.acceptance.landed).toHaveLength(0);
    expect(rig.engine.store.loadCandidate("T-2")?.status).toBe("discarded");
    expect(rig.worker.modelTurns).toBe(0);
  });

  it("commits twelve holds in one immediate transaction and rolls them all back on failure", () => {
    const readings = [1, 2, 3, 4].map((index) =>
      reading({
        id: `R${index}`,
        featureId: `F-${index}`,
        label: `Feature ${index}`,
        deltaText: `delta ${index}`,
      }),
    );
    const catalog: TaskSnapshot[] = [];
    const edges = new Map<string, readonly string[]>();
    for (const item of readings) {
      const taskIds: string[] = [];
      for (let slot = 1; slot <= 3; slot += 1) {
        const taskId = `${item.featureId}-T${slot}`;
        taskIds.push(taskId);
        catalog.push(task({ taskId, featureId: item.featureId, progress: 0.2, state: "CODING" }));
      }
      edges.set(item.featureId, taskIds);
    }
    const rig = harness(edges);
    const placed = rig.engine.holdAmbiguousMessage(message(readings, { messageId: "200", subject: "scope" }), catalog);
    expect(placed.affectedTaskIds).toHaveLength(12);
    expect(placed.untouchedTaskIds).toHaveLength(0);
    expect(placed.walkerCalls).toBe(4);
    expect(rig.walker.calls).toHaveLength(4);
    expect(placed.transaction).toEqual(["BEGIN IMMEDIATE", "COMMIT"]);
    expect(rig.engine.store.countAllHolds()).toBe(12);

    const again = harness(edges);
    expect(() =>
      again.engine.holdAmbiguousMessage(message(readings, { messageId: "201", subject: "scope" }), catalog, {
        stageFault: { after: 6, message: "stop mid hold set" },
      }),
    ).toThrow(/stop mid hold set/);
    expect(again.engine.store.countAllHolds()).toBe(0);
    expect(again.worker.interrupts).toHaveLength(0);
    expect(again.engine.store.cardStatus("201")).toBeNull();

    const clearing = harness(edges);
    clearing.engine.holdAmbiguousMessage(message(readings, { messageId: "202", subject: "scope" }), catalog);
    expect(() =>
      clearing.engine.resolveClarification(
        { messageId: "202", reply: "apply it to both" },
        { releaseFault: { after: 4, message: "stop mid release" } },
      ),
    ).toThrow(/stop mid release/);
    expect(clearing.engine.store.countAllHolds()).toBe(12);
    expect(clearing.engine.store.cardStatus("202")).toBe("open");
  });

  it("reminds once after ten minutes only when a critical-path task is still held", () => {
    const now = 0;
    const rig = harness(kitchenEdges(), () => now);
    rig.engine.holdAmbiguousMessage(kitchenMessage(), kitchenCatalog());
    expect(rig.engine.tickReminders(TEN_MINUTES_MS)).toEqual([]);
    const due = rig.engine.tickReminders(TEN_MINUTES_MS + 1);
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({
      messageId: "104",
      tone: "calm",
      autoGuessed: false,
      blockedCriticalTaskIds: ["T-1"],
    });
    expect(due[0]?.text).toContain("export timestamps");
    expect(due[0]?.text).toContain("Orders");
    expect(due[0]?.text).toContain("Reports");
    expect(due[0]?.text.startsWith("Still waiting")).toBe(true);
    expect(rig.engine.tickReminders(TEN_MINUTES_MS + 50_000)).toEqual([]);
    expect(rig.inbox.reminders).toHaveLength(1);

    const quiet = harness(
      kitchenEdges(),
      () => now,
    );
    const calmCatalog = kitchenCatalog().map((item) => ({ ...item, criticalPath: false }));
    quiet.engine.holdAmbiguousMessage(kitchenMessage(), calmCatalog);
    expect(quiet.engine.tickReminders(TEN_MINUTES_MS + 1)).toEqual([]);
  });
});

describe("HoldModeClassifier", () => {
  const classifier = new HoldModeClassifier();

  it("uses hard hold for early work and soft quarantine for verifying or nearly finished work", () => {
    expect(classifier.classify({ progress: 0.2, state: "CODING", impacted: true, destructive: false })).toEqual({
      action: "HARD_HOLD",
      quarantine: false,
    });
    expect(classifier.classify({ progress: 0.8, state: "CODING", impacted: true, destructive: false })).toEqual({
      action: "SOFT_HOLD",
      quarantine: true,
    });
    expect(classifier.classify({ progress: 0.1, state: "VERIFYING", impacted: true, destructive: false })).toEqual({
      action: "SOFT_HOLD",
      quarantine: true,
    });
    expect(classifier.classify({ progress: 0.95, state: "VERIFYING", impacted: true, destructive: true })).toEqual({
      action: "HARD_HOLD",
      quarantine: false,
    });
    expect(classifier.classify({ progress: 0.95, state: "VERIFYING", impacted: false, destructive: false })).toEqual({
      action: "continue",
    });
  });
});

describe("AdditiveVsContradictoryResumer", () => {
  it("treats a cutoff move as contradictory and an aria-label as additive", () => {
    const worker = new LocalWorkerSession();
    const resumer = new AdditiveVsContradictoryResumer(worker);
    const pinned = task({
      taskId: "T-cut",
      featureId: "F-Orders",
      briefText: "Orders close at 11:00.",
      requirements: ["cutoff 11:00"],
      sliceSha256: "pinned-cutoff",
    });
    const contradictory = resumer.inspect(pinned, {
      sliceSha256: "next-cutoff",
      text: "Orders close at 10:00.",
      requirements: ["cutoff 11:00"],
      changeKind: "additive",
      deltaNote: "cutoff moved",
      contradictedTokens: ["11:00"],
    });
    expect(contradictory.kind).toBe("contradictory");

    const additive = resumer.inspect(
      task({
        taskId: "T-aria",
        featureId: "F-Ui",
        briefText: "Render the button.",
        requirements: ["button"],
        sliceSha256: "pinned-aria",
      }),
      {
        sliceSha256: "next-aria",
        text: "Render the button.\nAlso add an aria-label.",
        requirements: ["button", "Also add an aria-label."],
        changeKind: "additive",
        deltaNote: "Also add an aria-label.",
        contradictedTokens: [],
      },
    );
    expect(additive.kind).toBe("additive");
    expect(additive.note?.text).toContain("Also add an aria-label.");
  });
});

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
