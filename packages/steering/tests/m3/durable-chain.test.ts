import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { openSteeringState } from "../../src/router/state-file.js";
import {
  dispatcher,
  durableTaskHolds,
  holds,
  openColdOpenReconciler,
  questionArbiter,
  reentry,
  router,
} from "../../src/index.js";
import { REENTRY_AWAITING_RESUME } from "../../src/reentry/types.js";

const directories: string[] = [];

afterEach(() => {
  while (directories.length > 0) {
    const dir = directories.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("C45 steering on ProjectStateDb", () => {
  it("exports router, dispatcher, holds, question arbiter, and reentry", () => {
    expect(router.SteeringMessageRouter).toBeTypeOf("function");
    expect(dispatcher.FourRouteSteeringDispatcher).toBeTypeOf("function");
    expect(holds.MultiInterpretationHoldEngine).toBeTypeOf("function");
    expect(questionArbiter.SharedQuestionArbiter).toBeTypeOf("function");
    expect(reentry.ColdOpenReconciler).toBeTypeOf("function");
    expect(reentry.ProjectReentryStore).toBeTypeOf("function");
  });

  it("holds, questions, and parked attempts share state.db without shadow tables", () => {
    const dir = mkdtempSync(join(tmpdir(), "c45-"));
    directories.push(dir);
    const statePath = join(dir, "state.db");
    const telemetryPath = join(dir, "telemetry.db");
    const state = openSteeringState(statePath);
    const holdsPort = durableTaskHolds(state);
    holdsPort.placeHold("T-pause", "user_pause", "msg:c45", 10);
    const reason = state.prepare(`SELECT reason FROM task_holds WHERE task = 'T-pause'`).get() as { reason: string };
    expect(reason.reason).toBe("user_pause");
    state.close();

    const arbiter = questionArbiter.openQuestionArbiter({ stateDbPath: statePath, telemetryDbPath: telemetryPath, now: () => 20 });
    const submitted = arbiter.arbiter.submit({
      buildId: "build-c45",
      workerId: "worker-T-1",
      waitingTaskId: "T-1",
      waitingRole: "worker",
      kind: "product",
      text: "Should the export include the order date?",
    });
    expect(submitted.lane).toBe("human_queue");
    if (submitted.lane !== "human_queue") throw new Error("expected a question card");
    const projection = arbiter.projection(submitted.card.questionId);
    expect(projection?.status).toBe("open");
    arbiter.close();
    const shadow = new DatabaseSync(statePath);
    const qa = shadow.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'qa_%'`).all();
    expect(qa).toEqual([]);
    const telemetryInState = shadow.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'telemetry'`).get();
    expect(telemetryInState).toBeUndefined();
    shadow.close();

    const parked = new reentry.ProjectReentryStore({
      projectId: "project-kitchen",
      snapshotId: "snap-1",
      integrationHead: "head",
      projectRoot: dir,
      attempts: [
        {
          id: "attempt-1",
          taskId: "T-1",
          status: "WORKING",
          pid: null,
          checkpointRef: "refs/harness/checkpoints/attempt-1/0",
          wipDiffPreserved: true,
        },
      ],
    });
    parked.markCheckpointed(["attempt-1"]);
    const attempt = parked.stateDb.prepare(`SELECT state FROM attempts WHERE id = 'attempt-1'`).get() as { state: string };
    expect(attempt.state).toBe("parked");
    const checkpoint = parked.stateDb.prepare(`SELECT attempt FROM attempt_checkpoints WHERE attempt = 'attempt-1'`).get();
    expect(checkpoint).toBeTruthy();
    parked.stateDb.close();

    const reopened = openSteeringState(statePath);
    const cold = openColdOpenReconciler(reopened);
    const report = cold.reconcile({
      snapshot: {
        projectId: "project-kitchen",
        snapshotId: "snap-1",
        projectName: "kitchen",
        projectRoot: dir,
        lastActiveAt: "2026-11-20T18:40:00.000Z",
        phaseLabel: "wave",
        whyStopped: "crash",
        expectedIntegrationHead: "missing-head",
        recordedBranch: "main",
        recordedHead: "",
        recordedOriginMain: null,
        walOk: true,
        walDetail: "ok",
        attempts: [],
        remainingTasks: [{ id: "T-1", title: "Export" }],
        parkedTasks: [],
        finishedFeatures: [],
        costEstimate: "$0.00",
        windowLabel: "weekly",
        lockHashes: { packageJson: null, pnpmLock: null },
        viewHashes: [],
        worktrees: [],
        connections: [],
        cliVersions: [],
        humanSteps: [],
        questions: [],
        failedTasks: [],
      },
      nowIso: "2026-11-22T18:40:00.000Z",
      reopen: "app_restart",
      buildWasInProgress: true,
      sleepMinutes: null,
      offline: false,
      repoChanged: false,
      networkChanged: false,
      forceHold: false,
      lastActiveLabel: "Friday",
      ledger: reentry.createSpendLedger(),
      gate: null,
    });
    expect(report.gate.phase).toBe(REENTRY_AWAITING_RESUME);
    expect(report.gate.tryActivity("start_worker").allowed).toBe(false);
    reopened.close();
  });
});
