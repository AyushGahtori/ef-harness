import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  WorktreeSlotPool,
  type AcquireSlotRequest,
  type ReleaseSlotRequest,
  type SlotHandle,
} from "@ef-harness/git-engine";
import { bindWorktreeSlotPool } from "../../src/runner/slot-pool-bind.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

class RecordingPool extends WorktreeSlotPool {
  readonly acquired: AcquireSlotRequest[] = [];
  readonly released: string[] = [];

  constructor(wtRoot: string) {
    super({ wtRoot });
  }

  override acquireSlot(request: AcquireSlotRequest): Promise<SlotHandle> {
    this.acquired.push(request);
    return Promise.resolve(handle(request));
  }

  override releaseSlot(request: ReleaseSlotRequest): Promise<void> {
    this.released.push(request.slotId);
    return Promise.resolve();
  }
}

describe("bindWorktreeSlotPool", () => {
  it("checks out through WorktreeSlotPool.acquireSlot", async () => {
    const root = mkdtempSync(join(tmpdir(), "ef-slot-pool-"));
    roots.push(root);
    const pool = new RecordingPool(root);
    const slots = bindWorktreeSlotPool(pool, {
      projectId: "project-1",
      mainRepoPath: root,
      taskId: "task-1",
      attempt: "attempt-1",
    });
    const slot = await slots.checkoutImmutable({
      commitSha: "a".repeat(40),
      kind: "verifier",
      excludeWorktreePath: join(root, "worker"),
      excludeWorktreeId: "worker-slot",
    });
    expect(pool.acquired).toEqual([
      {
        projectId: "project-1",
        mainRepoPath: root,
        baseCommit: "a".repeat(40),
        taskId: "task-1",
        attempt: "attempt-1",
      },
    ]);
    expect(slot).toEqual({
      slotId: "slot-1",
      commitSha: "a".repeat(40),
      worktreePath: join(root, "slot-1"),
      kind: "verifier",
    });
    await slots.attachLockedDependencies(slot, "lock-digest");
    await slots.release(slot);
    expect(pool.released).toEqual(["slot-1"]);
  });
});

function handle(request: AcquireSlotRequest): SlotHandle {
  return {
    projectId: request.projectId,
    projectShortId: "short",
    slotId: "slot-1",
    slotPath: join(request.mainRepoPath, "slot-1"),
    kind: "attempt",
    mainRepoPath: request.mainRepoPath,
    baseCommit: request.baseCommit,
    headCommit: request.baseCommit,
    branch: null,
    headMode: "detached",
    reused: false,
    nodeModulesPreserved: false,
    lockfileChanged: false,
    dependencySyncRequested: false,
    recommendSparseCheckout: false,
    recommendedParallelism: 1,
    worktreeAddDurationMs: 1,
    attemptBranchState: "not-applicable",
    recreatedFromCheckpoint: null,
  };
}
