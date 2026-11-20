import type { WorktreeSlotManager } from "./slot-manager.js";
import type {
  EnsureIntegrationWorktreeRequest,
  FastForwardIntegrationRequest,
  FastForwardResult,
  IntegrationLease,
  SlotExecutionPurpose,
  SlotHandle,
} from "./types.js";

/** Facade for the persistent integration worktree. Workers cannot execute here. */
export class IntegrationWorktreeController {
  constructor(private readonly slots: WorktreeSlotManager) {}

  ensureIntegrationWorktree(request: EnsureIntegrationWorktreeRequest): Promise<SlotHandle> {
    return this.slots.ensureIntegrationWorktree(request);
  }

  fastForwardIntegrationWorktree(request: FastForwardIntegrationRequest): Promise<FastForwardResult> {
    return this.slots.fastForwardIntegrationWorktree(request);
  }

  setIntegrationLease(projectId: string, mainRepoPath: string, lease: IntegrationLease): Promise<void> {
    return this.slots.setIntegrationLease(projectId, mainRepoPath, lease);
  }

  assertExecutionAllowed(
    projectId: string,
    mainRepoPath: string,
    slotPath: string,
    purpose: SlotExecutionPurpose,
  ): Promise<void> {
    return this.slots.assertExecutionAllowed(projectId, mainRepoPath, slotPath, purpose);
  }
}
