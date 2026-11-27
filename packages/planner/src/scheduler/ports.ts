import type {
  ClaimRefusalReason,
  HoldReason,
  PathLeaseView,
  ProviderConnection,
  TaskHoldRecord,
} from "./types.js";
import { scopeHitsLease } from "./write-scope.js";

export interface ClaimTaskInput {
  readonly task: string;
  readonly attemptId: string;
  readonly expectedBrief: number;
  readonly expiresAt: number;
  readonly rev: number;
  readonly runtime: string;
  readonly model: string;
  readonly connection: string;
  readonly baseCommit: string;
  readonly now: number;
  readonly featureBranch: string;
  readonly writeScope: readonly string[];
}

export type ClaimResult =
  | { readonly claimed: true; readonly epoch: number; readonly attemptId: string }
  | { readonly claimed: false; readonly reason: ClaimRefusalReason };

/**
 * Local port for Task 020 `TaskLeaseManager.claimTask`.
 * The sibling export is `TaskLeaseManager`, not `TaskClaimManager`.
 */
export interface TaskClaimManagerPort {
  claimTask(input: ClaimTaskInput): ClaimResult;
}

export interface PlaceHoldInput {
  readonly task: string;
  readonly reason: HoldReason;
  readonly source: string;
  readonly now: number;
}

export interface ReleaseHoldInput {
  readonly task: string;
  readonly reason: HoldReason;
  readonly source: string;
  readonly now: number;
}

/**
 * Local port for Task 021 `TaskHoldAndSubmissionRepo`.
 * The sibling export is `TaskHoldAndSubmissionRepo`, not `TaskHoldsManager`.
 */
export interface TaskHoldsManagerPort {
  isTaskHeld(task: string): boolean;
  listActiveHolds(task: string): readonly TaskHoldRecord[];
  placeHold(input: PlaceHoldInput): void;
  releaseHold(input: ReleaseHoldInput): void;
}

export function isConnectionUsable(connection: ProviderConnection, paidFallbackApproved: boolean): boolean {
  if (!connection.authorized || connection.throttled || connection.allowanceExhausted) return false;
  if (!Number.isInteger(connection.pacingSlots) || connection.pacingSlots <= 0) return false;
  if (connection.kind === "paid_api" && !paidFallbackApproved) return false;
  return true;
}

export function pacingCapOf(connections: readonly ProviderConnection[], paidFallbackApproved: boolean): number {
  if (connections.length === 0) return Number.POSITIVE_INFINITY;
  let slots = 0;
  for (const connection of connections) {
    if (isConnectionUsable(connection, paidFallbackApproved)) slots += connection.pacingSlots;
  }
  return slots;
}

export function orderConnections(
  connections: readonly ProviderConnection[],
  paidFallbackApproved: boolean,
  preferSubscription: boolean,
): readonly ProviderConnection[] {
  return connections.filter((connection) => isConnectionUsable(connection, paidFallbackApproved)).sort((left, right) => {
    if (preferSubscription && left.kind !== right.kind) {
      return left.kind === "subscription" ? -1 : 1;
    }
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}

export interface ClaimWorld {
  held: ReadonlySet<string>;
  completed: ReadonlySet<string>;
  predecessors: ReadonlyMap<string, readonly string[]>;
  leases: readonly PathLeaseView[];
  scopes: ReadonlyMap<string, readonly string[]>;
}

export class InMemoryTaskClaimManager implements TaskClaimManagerPort {
  private epoch = 0;

  constructor(private readonly world: ClaimWorld) {}

  claimTask(input: ClaimTaskInput): ClaimResult {
    if (this.world.held.has(input.task)) return { claimed: false, reason: "held" };
    const preds = this.world.predecessors.get(input.task) ?? [];
    if (preds.some((pred) => !this.world.completed.has(pred))) {
      return { claimed: false, reason: "dependency_open" };
    }
    const scope = this.world.scopes.get(input.task) ?? input.writeScope;
    for (const lease of this.world.leases) {
      if (lease.mode !== "intent" && lease.mode !== "granted") continue;
      if (scopeHitsLease(scope, lease.prefixes)) return { claimed: false, reason: "sweep_overlap" };
    }
    this.epoch += 1;
    return { claimed: true, epoch: this.epoch, attemptId: input.attemptId };
  }
}

export class InMemoryTaskHoldsManager implements TaskHoldsManagerPort {
  private readonly rows: TaskHoldRecord[] = [];

  isTaskHeld(task: string): boolean {
    return this.rows.some((row) => row.taskId === task);
  }

  listActiveHolds(task: string): readonly TaskHoldRecord[] {
    return this.rows.filter((row) => row.taskId === task);
  }

  placeHold(input: PlaceHoldInput): void {
    if (this.rows.some((row) => row.taskId === input.task && row.reason === input.reason && row.source === input.source)) {
      return;
    }
    this.rows.push({
      taskId: input.task,
      reason: input.reason,
      source: input.source,
      createdAtMs: input.now,
    });
  }

  releaseHold(input: ReleaseHoldInput): void {
    const index = this.rows.findIndex(
      (row) => row.taskId === input.task && row.reason === input.reason && row.source === input.source,
    );
    if (index >= 0) this.rows.splice(index, 1);
  }
}
