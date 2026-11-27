import {
  isHoldReason as isDbHoldReason,
  type HoldReason as DbHoldReason,
  type TaskHold,
  type TaskHoldAndSubmissionRepo,
  type TaskLeaseManager,
} from "@ef-harness/db";
import { SchedulerError } from "./errors.js";
import {
  coerceTaskHoldReason,
  type ClaimRefusalReason,
  type PathLeaseView,
  type ProviderConnection,
  type TaskHoldReason,
  type TaskHoldRecord,
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

export interface TaskClaimManagerPort {
  claimTask(input: ClaimTaskInput): ClaimResult;
}

export interface PlaceHoldInput {
  readonly task: string;
  readonly reason: TaskHoldReason;
  readonly source: string;
  readonly now: number;
  readonly rev?: number;
}

export interface ReleaseHoldInput {
  readonly task: string;
  readonly reason: TaskHoldReason;
  readonly source: string;
  readonly now: number;
  readonly rev?: number;
}

export interface TaskHoldsManagerPort {
  isTaskHeld(task: string): boolean;
  listActiveHolds(task: string): readonly TaskHoldRecord[];
  placeHold(input: PlaceHoldInput): void;
  releaseHold(input: ReleaseHoldInput): void;
}

const EDITOR_OVERLAP_SOURCE_PREFIX = "editor_overlap:";

function isMissingTaskFkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.includes("FOREIGN KEY constraint failed");
}

export function bindTaskClaimManager(
  leases: TaskLeaseManager,
  options: { readonly registerScopes?: boolean } = {},
): TaskClaimManagerPort {
  const registerScopes = options.registerScopes ?? true;
  return {
    claimTask(input: ClaimTaskInput): ClaimResult {
      if (registerScopes && input.writeScope.length > 0) {
        try {
          leases.registerTaskScopes(input.task, input.writeScope);
        } catch (error) {
          if (!isMissingTaskFkError(error)) throw error;
        }
      }
      return leases.claimTask({
        task: input.task,
        attemptId: input.attemptId,
        expectedBrief: input.expectedBrief,
        expiresAt: input.expiresAt,
        rev: input.rev,
        runtime: input.runtime,
        model: input.model,
        connection: input.connection,
        baseCommit: input.baseCommit,
        now: input.now,
      });
    },
  };
}

function toDbHold(
  reason: TaskHoldReason,
  source: string,
): { readonly reason: DbHoldReason; readonly source: string } {
  const canonical = coerceTaskHoldReason(reason);
  if (isDbHoldReason(canonical)) return { reason: canonical, source };
  if (canonical === "editor_overlap") {
    return {
      reason: "user_pause",
      source: source.startsWith(EDITOR_OVERLAP_SOURCE_PREFIX)
        ? source
        : `${EDITOR_OVERLAP_SOURCE_PREFIX}${source}`,
    };
  }
  throw new SchedulerError("invalid_graph", `Unsupported task hold reason: ${reason}`);
}

function fromDbHold(hold: TaskHold): TaskHoldRecord {
  if (hold.reason === "user_pause" && hold.source.startsWith(EDITOR_OVERLAP_SOURCE_PREFIX)) {
    return {
      taskId: hold.task,
      reason: "editor_overlap",
      source: hold.source.slice(EDITOR_OVERLAP_SOURCE_PREFIX.length),
      createdAtMs: hold.createdAt,
    };
  }
  return {
    taskId: hold.task,
    reason: hold.reason,
    source: hold.source,
    createdAtMs: hold.createdAt,
  };
}

export function bindTaskHoldsManager(
  repo: TaskHoldAndSubmissionRepo,
  options: { readonly nextRev?: () => number } = {},
): TaskHoldsManagerPort {
  let fallbackRev = 0;
  const nextRev = options.nextRev ?? (() => {
    fallbackRev += 1;
    return fallbackRev;
  });
  return {
    isTaskHeld(task: string): boolean {
      return repo.isTaskHeld(task);
    },
    listActiveHolds(task: string): readonly TaskHoldRecord[] {
      return repo.listActiveHolds(task).map(fromDbHold);
    },
    placeHold(input: PlaceHoldInput): void {
      const mapped = toDbHold(input.reason, input.source);
      repo.placeHold({
        task: input.task,
        reason: mapped.reason,
        source: mapped.source,
        now: input.now,
        rev: input.rev ?? nextRev(),
      });
    },
    releaseHold(input: ReleaseHoldInput): void {
      const mapped = toDbHold(input.reason, input.source);
      repo.releaseHold({
        task: input.task,
        reason: mapped.reason,
        source: mapped.source,
        now: input.now,
        rev: input.rev ?? nextRev(),
      });
    },
  };
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
    const reason = coerceTaskHoldReason(input.reason);
    if (this.rows.some((row) => row.taskId === input.task && row.reason === reason && row.source === input.source)) {
      return;
    }
    this.rows.push({
      taskId: input.task,
      reason,
      source: input.source,
      createdAtMs: input.now,
    });
  }

  releaseHold(input: ReleaseHoldInput): void {
    const reason = coerceTaskHoldReason(input.reason);
    const index = this.rows.findIndex(
      (row) => row.taskId === input.task && row.reason === reason && row.source === input.source,
    );
    if (index >= 0) this.rows.splice(index, 1);
  }
}
