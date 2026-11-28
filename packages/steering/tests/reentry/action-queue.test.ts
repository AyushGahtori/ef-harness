import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ColdOpenReconciler,
  ProjectReentryStore,
  ReconciledActionQueue,
  confirmationForResumeBuild,
  createFileIndexLockPort,
} from "../../src/reentry/index.js";
import { coldInput, commit, fakePorts, presentRepo, snapshot } from "./fixture.js";

describe("ReconciledActionQueue", () => {
  it("applies only confirmed items and leaves commit-answered questions open", () => {
    const state = snapshot({
      attempts: [
        {
          id: "a1",
          taskId: "T-1",
          status: "WORKING",
          pid: 4,
          checkpointRef: "refs/checkpoints/a1",
          wipDiffPreserved: true,
        },
      ],
      failedTasks: [{ id: "T-4", writeScope: ["orders/**"], failingChecks: ["orders/edit.ts"] }],
      questions: [
        {
          id: "Q-11",
          prompt: "cutoff",
          openedAt: "2026-11-20T00:00:00.000Z",
          targetFiles: ["orders/edit.ts"],
          decisionContext: null,
          neededByTaskId: null,
          effectHint: null,
          revalidation: "still_relevant",
          sinceLabel: null,
        },
      ],
    });
    const report = new ColdOpenReconciler(
      fakePorts({
        repo: presentRepo({
          commits: [commit({ sha: "3f2a91c0", subject: "fix cutoff tz", files: ["orders/edit.ts"] })],
        }),
        locks: { packageJson: "pkg-hash", pnpmLock: "changed" },
        views: [{ path: ".harness/views/notes.md", sha256: "edited" }],
      }),
    ).reconcile(coldInput(state));
    const store = new ProjectReentryStore({
      projectId: state.projectId,
      snapshotId: state.snapshotId,
      integrationHead: state.expectedIntegrationHead,
      projectRoot: state.projectRoot,
      attempts: state.attempts,
    });
    const result = new ReconciledActionQueue(store, idleLocks()).apply(report, confirmationForResumeBuild());
    expect(result.lifted).toBe(true);
    expect(result.phase).toBe("RESUMED");
    expect(result.integrationHead).toBe("integration-head");
    expect(result.projectId).toBe("project-kitchen");
    expect(result.snapshotId).toBe("snap-1");
    expect(store.attempts[0]?.status).toBe("parked");
    const row = store.stateDb.prepare(`SELECT state FROM attempts WHERE id = 'a1'`).get() as { state: string };
    expect(row.state).toBe("parked");
    const checkpoint = store.stateDb.prepare(`SELECT attempt, wip_ref FROM attempt_checkpoints WHERE attempt = 'a1'`).get() as {
      attempt: string;
      wip_ref: string;
    };
    expect(checkpoint.attempt).toBe("a1");
    expect(checkpoint.wip_ref).toBe("refs/checkpoints/a1");
    const illegal = store.stateDb.prepare(`SELECT COUNT(*) AS n FROM attempts WHERE state = 'CHECKPOINTED'`).get() as { n: number };
    expect(Number(illegal.n)).toBe(0);
    expect(store.attempts[0]?.checkpointRef).toBe("refs/checkpoints/a1");
    expect(store.attempts[0]?.wipDiffPreserved).toBe(true);
    expect(store.closedQuestionIds).toEqual([]);
    expect(store.verifiedTaskIds).toEqual([]);
    expect(store.lockfileIncluded).toBe(false);
    expect(store.includedCommits).toEqual([]);
    expect(store.importedViews).toEqual([]);
    expect(result.skipped.some((item) => item.type === "resolve_commit_answered" && item.reason === "not_confirmed")).toBe(
      true,
    );
    expect(report.gate.tryActivity("start_worker").allowed).toBe(true);
  });

  it("closes a commit-answered question only when the developer confirms it", () => {
    const state = snapshot({
      failedTasks: [{ id: "T-6", writeScope: ["src/orders/**"], failingChecks: ["src/orders/cutoff.ts"] }],
    });
    const report = new ColdOpenReconciler(
      fakePorts({
        repo: presentRepo({
          commits: [commit({ sha: "abc12345", subject: "fix: order cutoff timezone", files: ["src/orders/cutoff.ts"] })],
        }),
      }),
    ).reconcile(coldInput(state));
    const match = report.commitAnswered[0];
    expect(match?.offers).toContain("Verify your commit against T-6's checks & mark done?");
    expect(match?.autoClosed).toBe(false);
    const store = storeFor(state);
    new ReconciledActionQueue(store, idleLocks()).apply(
      report,
      confirmationForResumeBuild({ verifyMatchIds: match ? [match.matchId] : [] }),
    );
    expect(store.verifiedTaskIds).toEqual(["T-6"]);
  });

  it("rolls back when a confirmed apply fails and does not lift the gate", () => {
    const state = snapshot({
      attempts: [
        {
          id: "a1",
          taskId: "T-1",
          status: "WORKING",
          pid: null,
          checkpointRef: "refs/checkpoints/a1",
          wipDiffPreserved: true,
        },
      ],
    });
    const report = new ColdOpenReconciler(
      fakePorts({ locks: { packageJson: "one", pnpmLock: "two" } }),
    ).reconcile(coldInput(state));
    const store = storeFor(state);
    store.failOn = "include_lockfile";
    const result = new ReconciledActionQueue(store, idleLocks()).apply(
      report,
      confirmationForResumeBuild({ includeLockfile: true }),
    );
    expect(result.lifted).toBe(false);
    expect(result.phase).toBe("REENTRY_AWAITING_RESUME");
    expect(store.attempts[0]?.status).toBe("WORKING");
    expect(store.lockfileIncluded).toBe(false);
    expect(store.integrationHead).toBe(state.expectedIntegrationHead);
    expect(report.gate.tryActivity("mutate_git").allowed).toBe(false);
  });

  it("relocates a missing folder and preserves project identity", () => {
    const state = snapshot({ projectRoot: "D:/code/kitchen" });
    const report = new ColdOpenReconciler(
      fakePorts({ repo: { missing: true, code: "ENOENT", message: "Project folder moved — Locate folder" } }),
    ).reconcile(coldInput(state));
    const store = storeFor(state);
    const blocked = new ReconciledActionQueue(store, idleLocks()).apply(report, confirmationForResumeBuild());
    expect(blocked.lifted).toBe(false);
    expect(blocked.blockedReason).toBe("Project folder moved — Locate folder");
    expect(store.projectRoot).toBe("D:/code/kitchen");
    const moved = new ReconciledActionQueue(store, idleLocks()).apply(
      report,
      confirmationForResumeBuild({ relocateTo: "D:/projects/kitchen" }),
    );
    expect(moved.lifted).toBe(true);
    expect(moved.projectRoot).toBe("D:/projects/kitchen");
    expect(moved.projectId).toBe(state.projectId);
    expect(moved.snapshotId).toBe(state.snapshotId);
    expect(moved.integrationHead).toBe(state.expectedIntegrationHead);
  });

  it("deletes a stale index lock on resume and leaves a live lock on disk", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ef-reentry-apply-"));
      const lock = path.join(root, ".git", "index.lock");
      mkdirSync(path.dirname(lock), { recursive: true });
    try {
      writeFileSync(lock, "lock");
      const past = new Date(Date.now() - 120_000);
      utimesSync(lock, past, past);
      const processes = { reliable: true, isAlive: () => false, liveGitPids: () => [] as number[] };
      const state = snapshot();
      const report = new ColdOpenReconciler(
        fakePorts({
          repo: presentRepo({ indexLockPath: lock, indexLockMtimeMs: past.getTime() }),
        }),
      ).reconcile(coldInput(state));
      const queue = new ReconciledActionQueue(storeFor(state), createFileIndexLockPort(processes));
      queue.apply(report, confirmationForResumeBuild());
      expect(existsSync(lock)).toBe(false);

      writeFileSync(lock, "lock");
      const liveProcesses = { reliable: true, isAlive: () => false, liveGitPids: () => [7] };
      const liveReport = new ColdOpenReconciler(
        fakePorts({
          gitPids: [7],
          repo: presentRepo({ indexLockPath: lock, indexLockMtimeMs: Date.now() - 120_000 }),
        }),
      ).reconcile(coldInput(snapshot()));
      new ReconciledActionQueue(storeFor(snapshot()), createFileIndexLockPort(liveProcesses)).apply(
        liveReport,
        confirmationForResumeBuild(),
      );
      expect(existsSync(lock)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function storeFor(state: ReturnType<typeof snapshot>): ProjectReentryStore {
  return new ProjectReentryStore({
    projectId: state.projectId,
    snapshotId: state.snapshotId,
    integrationHead: state.expectedIntegrationHead,
    projectRoot: state.projectRoot,
    attempts: state.attempts,
  });
}

function idleLocks() {
  return {
    assess: () => ({ safe: false, reason: "no index lock" }),
    remove: () => undefined,
    restore: () => undefined,
  };
}
