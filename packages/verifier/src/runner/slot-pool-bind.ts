import { WorktreeSlotPool } from "@ef-harness/git-engine";
import type { WorktreeSlotManagerPort } from "./ports.js";

/**
 * `WorktreeSlotPool` is `WorktreeSlotManager`. Checkout goes through `acquireSlot`.
 * The verifier port still reports `kind: "verifier"`; the pool slot stays an attempt slot.
 */
export function bindWorktreeSlotPool(
  pool: WorktreeSlotPool,
  scope: {
    readonly projectId: string;
    readonly mainRepoPath: string;
    readonly taskId: string;
    readonly attempt: string;
  },
): WorktreeSlotManagerPort {
  return {
    async checkoutImmutable(request) {
      const handle = await pool.acquireSlot({
        projectId: scope.projectId,
        mainRepoPath: scope.mainRepoPath,
        baseCommit: request.commitSha,
        taskId: scope.taskId,
        attempt: scope.attempt,
      });
      return {
        slotId: handle.slotId,
        commitSha: handle.headCommit,
        worktreePath: handle.slotPath,
        kind: "verifier",
      };
    },
    async attachLockedDependencies(slot, lockDigest) {
      if (slot.slotId.length === 0 || lockDigest.length === 0) {
        throw new Error("verifier slot is missing a lock digest");
      }
    },
    async release(slot) {
      await pool.releaseSlot({
        projectId: scope.projectId,
        mainRepoPath: scope.mainRepoPath,
        slotId: slot.slotId,
        outcome: "merged",
      });
    },
  };
}
