import { describe, expect, it } from "vitest";
import {
  ColdOpenReconciler,
  NoRunUntilResumeGate,
  REENTRY_AWAITING_RESUME,
  classifyWake,
  reconcileAfterWake,
} from "../../src/reentry/index.js";
import { coldInput, fakePorts, snapshot } from "./fixture.js";

describe("reconcileAfterWake", () => {
  it("classifies a short wake, a 30 minute boundary, and a long or changed wake", () => {
    expect(classifyWake(10 * 60 * 1000 - 1, quiet()).fastPath).toBe(true);
    expect(classifyWake(10 * 60 * 1000, quiet()).fastPath).toBe(false);
    expect(classifyWake(10 * 60 * 1000, quiet()).holdWelcomeBack).toBe(false);
    expect(classifyWake(30 * 60 * 1000, quiet()).holdWelcomeBack).toBe(false);
    expect(classifyWake(30 * 60 * 1000 + 1, quiet()).holdWelcomeBack).toBe(true);
    expect(classifyWake(5 * 60 * 1000, { repoChanged: true, networkChanged: false, offline: false }).holdWelcomeBack).toBe(
      true,
    );
    expect(classifyWake(5 * 60 * 1000, { repoChanged: false, networkChanged: true, offline: false }).kind).toBe(
      "environment_changed",
    );
  });

  it("stays on the fast path for a 9 minute wake and does not dispatch or scan", () => {
    const { reconciler, calls } = countingReconciler();
    const gate = new NoRunUntilResumeGate();
    gate.open({
      reopen: "crash",
      buildWasInProgress: true,
      sleepMinutes: null,
      repoChanged: false,
      networkChanged: false,
      offline: false,
      forceHold: false,
      untouchedNewIdleProject: false,
    });
    const state = snapshot({
      attempts: [
        { id: "a1", taskId: "T-1", status: "WORKING", pid: 4, checkpointRef: "refs/checkpoints/a1", wipDiffPreserved: true },
      ],
    });
    const result = reconcileAfterWake(
      wake("2026-11-22T12:00:00.000Z", "2026-11-22T12:09:00.000Z", { buildWasInProgress: true }),
      coldInput(state, { gate }),
      reconciler,
    );
    expect(result.fastPath).toBe(true);
    expect(result.holdWelcomeBack).toBe(false);
    expect(result.fullReport).toBeNull();
    expect(result.dispatchedWorkers).toBe(false);
    expect(result.tokensSpent).toBe(0);
    expect(result.centsSpent).toBe(0);
    expect(result.inFlightOutcome).toBe("unknown");
    expect(result.resumeFromCheckpoint).toBe(true);
    expect(calls.count).toBe(0);
    expect(gate.phase).toBe("OPEN");
    expect(gate.tryActivity("start_worker").allowed).toBe(true);
  });

  it("holds a 4 hour offline wake at welcome-back without spending", () => {
    const { reconciler, calls } = countingReconciler();
    const state = snapshot();
    const result = reconcileAfterWake(
      wake("2026-11-22T08:00:00.000Z", "2026-11-22T12:00:00.000Z", { offline: true, buildWasInProgress: true }),
      coldInput(state),
      reconciler,
    );
    expect(result.holdWelcomeBack).toBe(true);
    expect(result.fastPath).toBe(false);
    expect(result.dispatchedWorkers).toBe(false);
    expect(result.tokensSpent).toBe(0);
    expect(result.note).toBe("Paused while laptop slept (4h) · Offline — Resume when back online");
    expect(result.fullReport?.gate.phase).toBe(REENTRY_AWAITING_RESUME);
    expect(result.fullReport?.gate.tryActivity("spend_tokens").allowed).toBe(false);
    expect(calls.count).toBeGreaterThan(0);
  });

  it("runs the full reconciler when the repo changed during a 5 minute sleep", () => {
    const { reconciler, calls } = countingReconciler();
    const result = reconcileAfterWake(
      wake("2026-11-22T12:00:00.000Z", "2026-11-22T12:05:00.000Z", { repoChanged: true }),
      coldInput(snapshot()),
      reconciler,
    );
    expect(result.kind).toBe("environment_changed");
    expect(result.holdWelcomeBack).toBe(true);
    expect(calls.count).toBeGreaterThan(0);
    expect(result.fullReport?.showWelcome).toBe(true);
  });
});

function quiet() {
  return { repoChanged: false, networkChanged: false, offline: false };
}

function wake(
  suspendedAt: string,
  resumedAt: string,
  patch: { repoChanged?: boolean; networkChanged?: boolean; offline?: boolean; buildWasInProgress?: boolean } = {},
) {
  return {
    suspendedAt,
    resumedAt,
    repoChanged: patch.repoChanged ?? false,
    networkChanged: patch.networkChanged ?? false,
    offline: patch.offline ?? false,
    buildWasInProgress: patch.buildWasInProgress ?? false,
  };
}

function countingReconciler(): { reconciler: ColdOpenReconciler; calls: { count: number } } {
  const calls = { count: 0 };
  const ports = fakePorts();
  const reconciler = new ColdOpenReconciler({
    ...ports,
    git: {
      inspect: (state) => {
        calls.count += 1;
        return ports.git.inspect(state);
      },
    },
  });
  return { reconciler, calls };
}
