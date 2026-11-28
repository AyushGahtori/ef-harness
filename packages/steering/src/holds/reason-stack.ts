import { withImmediateTransaction, type HoldStore, type StageHoldInput } from "./database.js";
import { holdKey } from "./format.js";
import type { ActiveHold } from "./types.js";

export interface StackRelease {
  readonly removed: boolean;
  readonly remaining: number;
  readonly holdKey: string;
}

/**
 * Independent hold reasons on one task.
 * Clearing `ambiguous_message_104` deletes that row only.
 * The task stays held until `activeCount === 0`.
 */
export class HoldReasonStackCoordinator {
  constructor(private readonly store: HoldStore) {}

  place(input: StageHoldInput): StackRelease {
    withImmediateTransaction(this.store.db, () => {
      this.store.stageHold(input);
    });
    return {
      removed: false,
      remaining: this.store.countHolds(input.taskId),
      holdKey: holdKey(input.reasonType, input.reasonRefId),
    };
  }

  stage(input: StageHoldInput): void {
    this.store.stageHold(input);
  }

  releaseOne(taskId: string, reasonType: string, reasonRefId: string): StackRelease {
    let removed = false;
    withImmediateTransaction(this.store.db, () => {
      removed = this.store.deleteHold(taskId, reasonType, reasonRefId);
    });
    return { removed, remaining: this.store.countHolds(taskId), holdKey: holdKey(reasonType, reasonRefId) };
  }

  deleteWithinTransaction(taskId: string, reasonType: string, reasonRefId: string): boolean {
    return this.store.deleteHold(taskId, reasonType, reasonRefId);
  }

  activeCount(taskId: string): number {
    return this.store.countHolds(taskId);
  }

  list(taskId: string): readonly ActiveHold[] {
    return this.store.listHolds(taskId);
  }

  listAll(): readonly ActiveHold[] {
    return this.store.listHolds();
  }
}
