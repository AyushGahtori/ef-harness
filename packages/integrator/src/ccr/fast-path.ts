import type { ContractOwner, DiffOp, FeatureState, OwnerTask } from "./types.js";
import type {
  LocalMigrationNamer,
  LocalProjectMergeQueue,
  LocalRegressionChecks,
  LocalSkeletonLock,
  LockDecision,
} from "./ports.js";
import { migrationSql } from "./ports.js";

export interface FastPathRequest {
  readonly ccrIds: readonly string[];
  readonly contractNodeId: string;
  readonly owner: ContractOwner;
  readonly requesterTaskIds: readonly string[];
  readonly primaryRequester: string;
  readonly ops: readonly DiffOp[];
  readonly ownerFeatureState: FeatureState;
  readonly runningFeatures: readonly string[];
  readonly requestingFeatureId: string;
  readonly contradictionCount: number;
  readonly semanticBreaking: boolean;
  readonly at: Date;
  readonly mutatedBy?: string;
  readonly extraContracts?: readonly { readonly contractNodeId: string; readonly ops: readonly DiffOp[] }[];
}

export type FastPathOutcome =
  | {
      readonly ok: true;
      readonly ownerTask: OwnerTask;
      readonly migrationName: string | null;
      readonly migrationSql: string | null;
      readonly commitSha: string;
      readonly wokenTaskIds: readonly string[];
      readonly unrelatedRunning: readonly string[];
      readonly lock: LockDecision;
    }
  | {
      readonly ok: false;
      readonly reason: "owner_hold" | "contradiction" | "lock" | "not_additive" | "semantic" | "regression";
      readonly detail: string;
      readonly failedChecks: readonly string[];
      readonly lock: LockDecision | null;
    };

export class AdditiveOwnerFastPath {
  constructor(
    private readonly locks: LocalSkeletonLock,
    private readonly migrations: LocalMigrationNamer,
    private readonly mergeQueue: LocalProjectMergeQueue,
    private readonly regression: LocalRegressionChecks,
    private readonly nextOwnerTaskId: () => string,
  ) {}

  execute(input: FastPathRequest): FastPathOutcome {
    if (input.semanticBreaking || input.ops.some((op) => op.breaking)) {
      return refuse(input.semanticBreaking ? "semantic" : "not_additive", "Fast path accepts only a strictly additive diff.", []);
    }
    if (input.contradictionCount > 0) {
      return refuse("contradiction", "Additive fast path requires zero contradictions.", []);
    }
    if (input.ownerFeatureState === "HOLD") {
      return refuse("owner_hold", `Owner feature ${input.owner.ownerFeatureId} is HOLD.`, []);
    }
    const lock = this.locks.evaluate(input.contractNodeId, input.ops);
    if (!lock.allowed || lock.classification === "breaking") {
      return { ok: false, reason: "lock", detail: lock.reason, failedChecks: [], lock };
    }
    for (const extra of input.extraContracts ?? []) {
      const extraLock = this.locks.evaluate(extra.contractNodeId, extra.ops);
      if (!extraLock.allowed || extra.ops.some((op) => op.breaking)) {
        return { ok: false, reason: "lock", detail: extraLock.reason, failedChecks: [], lock: extraLock };
      }
    }
    const sql = migrationSql([...input.ops, ...(input.extraContracts ?? []).flatMap((extra) => [...extra.ops])]);
    const slug = slugFrom(input.ops, input.contractNodeId);
    const named = sql
      ? this.migrations.name({ featureId: input.owner.ownerFeatureId, slug, sql, at: input.at })
      : null;
    const checkId = `compat:${input.contractNodeId}`;
    const checks = [checkId];
    const regression = this.regression.run(checks);
    if (!regression.passed) {
      return { ok: false, reason: "regression", detail: "Backward-compatibility checks failed.", failedChecks: regression.failed, lock };
    }
    const mutatedBy = input.mutatedBy ?? input.owner.ownerTaskId;
    const ownerTask: OwnerTask = {
      taskId: this.nextOwnerTaskId(),
      ownerTaskId: input.owner.ownerTaskId,
      ownerRole: input.mutatedBy ? input.mutatedBy : input.owner.ownerRole,
      mutatedBy,
      requestingConsumer: input.primaryRequester,
      consumerMayEdit: false,
      contractNodeId: input.contractNodeId,
      contractUpdate: input.ops.map((op) => op.detail).join("; "),
      migrationName: named?.path ?? null,
      migrationSql: sql,
      backwardCompatibilityTestId: checkId,
      ccrIds: input.ccrIds,
    };
    if (ownerTask.mutatedBy === input.primaryRequester && input.mutatedBy === undefined && input.owner.ownerTaskId !== input.primaryRequester) {
      return refuse("not_additive", "The requesting consumer must not edit the shared contract.", []);
    }
    const landed = this.mergeQueue.land({
      ccrIds: input.ccrIds,
      ownerTaskId: ownerTask.taskId,
      migrationName: ownerTask.migrationName,
      contractNodeId: input.contractNodeId,
      regressionChecks: checks,
    });
    return {
      ok: true,
      ownerTask,
      migrationName: ownerTask.migrationName,
      migrationSql: sql,
      commitSha: landed.commitSha,
      wokenTaskIds: [...input.requesterTaskIds],
      unrelatedRunning: input.runningFeatures.filter((featureId) => featureId !== input.requestingFeatureId),
      lock,
    };
  }
}

function refuse(
  reason: "owner_hold" | "contradiction" | "not_additive" | "semantic" | "regression",
  detail: string,
  failedChecks: readonly string[],
): FastPathOutcome {
  return { ok: false, reason, detail, failedChecks, lock: null };
}

function slugFrom(ops: readonly DiffOp[], contractNodeId: string): string {
  const column = ops.find((op) => op.payload.column)?.payload.column;
  return column && column.length > 0 ? column : contractNodeId;
}
