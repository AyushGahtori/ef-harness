import { ReadModelHealError } from "./errors.js";
import type { ReadModelLogger } from "./logger.js";
import type { QueryCatalog } from "./query-catalog.js";
import type { ReadModelDatabase } from "./sql.js";
import { ensureMonotonicCheckTimestamps } from "./timestamps.js";
import type {
  DriftBugAlert,
  DriftReport,
  RequirementRollupDriftRow,
  RequirementStatusDriftRow,
  RequirementStatusName,
  TaskRollupDriftRow,
} from "./types.js";
import { compareText, nullableInteger, nullableText, requirementStatus, text } from "./values.js";
import { loadRecomputed } from "./waivers.js";

const REQUIREMENT_ROLLUP_DRIFT = `
SELECT coalesce(a.feature, b.feature) AS feature,
       coalesce(a.status, b.status) AS status,
       a.n AS rollup_n,
       b.n AS actual_n
  FROM rollup_feature_requirements a
  FULL OUTER JOIN (
        SELECT coalesce(feature, '') AS feature, status, count(*) AS n
          FROM requirement_status
         GROUP BY coalesce(feature, ''), status
       ) b
    ON a.feature = b.feature AND a.status = b.status
 WHERE coalesce(a.n, 0) <> coalesce(b.n, 0)
`;

export interface DriftSnapshot {
  readonly timestampsAdjusted: number;
  readonly taskRollup: readonly TaskRollupDriftRow[];
  readonly requirementRollup: readonly RequirementRollupDriftRow[];
  readonly requirementStatus: readonly RequirementStatusDriftRow[];
}

export function detectDrift(connection: ReadModelDatabase, catalog: QueryCatalog): DriftSnapshot {
  const timestampsAdjusted = ensureMonotonicCheckTimestamps(connection);
  const taskRollup = catalog
    .all("rollup_drift")
    .map((row) => ({
      feature: text(row.feature, "feature"),
      state: text(row.state, "state"),
      rollup_n: nullableInteger(row.rollup_n),
      actual_n: nullableInteger(row.actual_n),
    }))
    .sort((left, right) => compareText(left.feature, right.feature) || compareText(left.state, right.state));
  const requirementRollup = connection
    .prepare(REQUIREMENT_ROLLUP_DRIFT)
    .all()
    .map((row) => ({
      feature: text(row.feature, "feature"),
      status: text(row.status, "status"),
      rollup_n: nullableInteger(row.rollup_n),
      actual_n: nullableInteger(row.actual_n),
    }))
    .sort(
      (left, right) => compareText(left.feature, right.feature) || compareText(left.status, right.status),
    );
  const requirementStatus = diffRequirementStatus(connection, catalog);
  return { timestampsAdjusted, taskRollup, requirementRollup, requirementStatus };
}

export function healDrift(
  connection: ReadModelDatabase,
  catalog: QueryCatalog,
  snapshot: DriftSnapshot,
  updatedRev: number,
): void {
  const statusDrift = snapshot.requirementStatus.length > 0;
  const requirementRollupDrift = snapshot.requirementRollup.length > 0;
  const taskRollupDrift = snapshot.taskRollup.length > 0;
  if (statusDrift) {
    replaceRequirementStatuses(connection, catalog, updatedRev);
  } else if (requirementRollupDrift) {
    rebuildRequirementRollups(connection);
  }
  if (taskRollupDrift) {
    rebuildTaskRollups(connection);
  }
}

export function confirmHealed(connection: ReadModelDatabase, catalog: QueryCatalog): void {
  const again = detectDrift(connection, catalog);
  const remaining =
    again.taskRollup.length + again.requirementRollup.length + again.requirementStatus.length;
  if (remaining > 0) {
    throw new ReadModelHealError(`drift self-heal left ${String(remaining)} discrepant row(s)`);
  }
}

export function driftReport(snapshot: DriftSnapshot, healed: boolean): DriftReport {
  const drifted =
    snapshot.taskRollup.length > 0 ||
    snapshot.requirementRollup.length > 0 ||
    snapshot.requirementStatus.length > 0;
  return {
    drifted,
    healed,
    timestampsAdjusted: snapshot.timestampsAdjusted,
    taskRollup: snapshot.taskRollup,
    requirementRollup: snapshot.requirementRollup,
    requirementStatus: snapshot.requirementStatus,
  };
}

export function alertDrift(logger: ReadModelLogger, snapshot: DriftSnapshot): void {
  const entry: DriftBugAlert = {
    severity: "error",
    event: "kernel_bug.read_model_drift",
    message: driftMessage(snapshot),
    timestampsAdjusted: snapshot.timestampsAdjusted,
    taskRollup: snapshot.taskRollup,
    requirementRollup: snapshot.requirementRollup,
    requirementStatus: snapshot.requirementStatus,
  };
  logger.alert(entry);
}

export function rebuildRequirementRollups(connection: ReadModelDatabase): void {
  connection.withRollupRebuild(() => {
    connection.exec("DELETE FROM rollup_feature_requirements");
    connection.exec(
      `INSERT INTO rollup_feature_requirements(feature, status, n)
       SELECT coalesce(feature, ''), status, count(*)
         FROM requirement_status
        GROUP BY coalesce(feature, ''), status`,
    );
  });
}

function replaceRequirementStatuses(
  connection: ReadModelDatabase,
  catalog: QueryCatalog,
  updatedRev: number,
): void {
  const rows = loadRecomputed(catalog);
  const insert = connection.prepare(
    `INSERT INTO requirement_status(requirement, feature, status, updated_rev)
     VALUES (?, ?, ?, ?)`,
  );
  connection.withRollupRebuild(() => {
    connection.exec("DELETE FROM rollup_feature_requirements");
    connection.exec("DELETE FROM requirement_status");
    for (const row of rows) {
      insert.run([row.requirement, row.feature, row.status, updatedRev]);
    }
  });
}

function rebuildTaskRollups(connection: ReadModelDatabase): void {
  connection.withRollupRebuild(() => {
    connection.exec("DELETE FROM rollup_feature_tasks");
    connection.exec(
      `INSERT INTO rollup_feature_tasks(feature, state, n)
       SELECT feature, state, count(*)
         FROM task_runtime
        GROUP BY feature, state`,
    );
  });
}

function diffRequirementStatus(
  connection: ReadModelDatabase,
  catalog: QueryCatalog,
): RequirementStatusDriftRow[] {
  const recomputed = new Map(loadRecomputed(catalog).map((row) => [row.requirement, row]));
  const storedRows = connection
    .prepare("SELECT requirement, feature, status FROM requirement_status")
    .all();
  const stored = new Map<
    string,
    { feature: string | null; status: RequirementStatusName }
  >();
  for (const row of storedRows) {
    const requirement = text(row.requirement, "requirement");
    stored.set(requirement, {
      feature: nullableText(row.feature),
      status: requirementStatus(row.status),
    });
  }
  const diffs: RequirementStatusDriftRow[] = [];
  for (const [requirement, next] of recomputed) {
    const current = stored.get(requirement);
    if (
      !current ||
      current.status !== next.status ||
      current.feature !== next.feature
    ) {
      diffs.push({
        requirement,
        stored_feature: current?.feature ?? null,
        stored_status: current?.status ?? null,
        recomputed_feature: next.feature,
        recomputed_status: next.status,
      });
    }
  }
  for (const [requirement, current] of stored) {
    if (recomputed.has(requirement)) continue;
    diffs.push({
      requirement,
      stored_feature: current.feature,
      stored_status: current.status,
      recomputed_feature: null,
      recomputed_status: null,
    });
  }
  diffs.sort((left, right) => compareText(left.requirement, right.requirement));
  return diffs;
}

function driftMessage(snapshot: DriftSnapshot): string {
  return [
    "read model drift",
    `${String(snapshot.taskRollup.length)} task rollup row(s)`,
    `${String(snapshot.requirementRollup.length)} requirement rollup row(s)`,
    `${String(snapshot.requirementStatus.length)} requirement status row(s)`,
  ].join("; ");
}

export function storedRevision(connection: ReadModelDatabase): number {
  const row = connection.prepare("SELECT value FROM meta WHERE key = 'last_rev'").get();
  if (!row) return 0;
  const raw = text(row.value, "last_rev");
  if (!/^-?\d+$/.test(raw)) throw new Error("last_rev is not an integer");
  const revision = Number(raw);
  if (!Number.isSafeInteger(revision)) throw new Error("last_rev is outside the safe integer range");
  return revision;
}
