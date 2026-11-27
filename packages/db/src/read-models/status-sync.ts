import { InvalidSyncRequestError } from "./errors.js";
import { rebuildRequirementRollups } from "./drift.js";
import type { QueryCatalog } from "./query-catalog.js";
import type { ReadModelDatabase, ReadModelStatement } from "./sql.js";
import { ensureMonotonicCheckTimestamps } from "./timestamps.js";
import type {
  RecomputedRequirement,
  RequirementStatusName,
  RequirementStatusRow,
  RequirementStatusSyncRequest,
  RequirementStatusSyncResult,
} from "./types.js";
import { integer, nullableText, requirementStatus, text } from "./values.js";
import { assertWaiversPermit, loadRecomputed } from "./waivers.js";

interface StoredStatus {
  readonly feature: string | null;
  readonly status: RequirementStatusName;
  readonly updatedRev: number;
}

export function syncRequirementStatuses(
  connection: ReadModelDatabase,
  catalog: QueryCatalog,
  request: RequirementStatusSyncRequest & { readonly all?: boolean },
  updatedRev: number,
): RequirementStatusSyncResult {
  const timestampsAdjusted = ensureMonotonicCheckTimestamps(connection);
  const recomputed = new Map(loadRecomputed(catalog).map((row) => [row.requirement, row]));
  const stored = loadStored(connection);
  const ids = request.all ? unionIds(recomputed, stored) : targetIds(connection, request);
  const planned: RecomputedRequirement[] = [];
  for (const id of ids) {
    const next = recomputed.get(id);
    if (next) planned.push(next);
  }
  assertWaiversPermit(connection, planned);

  const updated: RequirementStatusRow[] = [];
  const removed: string[] = [];
  const statements = statusStatements(connection);
  for (const id of [...ids].sort()) {
    const next = recomputed.get(id);
    const current = stored.get(id);
    if (!next) {
      if (!current) continue;
      statements.remove.run([id]);
      removed.push(id);
      continue;
    }
    writeStatus(statements, current, next, updatedRev);
    updated.push({
      requirement: next.requirement,
      feature: next.feature,
      status: next.status,
      updatedRev,
    });
  }
  if (removed.length > 0) rebuildRequirementRollups(connection);
  return { updated, removed, timestampsAdjusted };
}

export function assertTargetedSync(request: RequirementStatusSyncRequest): void {
  const checks = request.checkIds?.length ?? 0;
  const requirements = request.requirementIds?.length ?? 0;
  if (checks + requirements === 0) {
    throw new InvalidSyncRequestError(
      "syncRequirementStatusForChecks requires checkIds or requirementIds",
    );
  }
}

function targetIds(
  connection: ReadModelDatabase,
  request: RequirementStatusSyncRequest,
): Set<string> {
  const ids = new Set<string>(request.requirementIds ?? []);
  const lookup = connection.prepare(
    "SELECT requirement_id FROM check_requirements WHERE check_id = ?",
  );
  for (const checkId of request.checkIds ?? []) {
    for (const row of lookup.all([checkId])) {
      ids.add(text(row.requirement_id, "requirement_id"));
    }
  }
  return ids;
}

function unionIds(
  recomputed: ReadonlyMap<string, RecomputedRequirement>,
  stored: ReadonlyMap<string, StoredStatus>,
): Set<string> {
  const ids = new Set<string>(recomputed.keys());
  for (const id of stored.keys()) ids.add(id);
  return ids;
}

function loadStored(connection: ReadModelDatabase): Map<string, StoredStatus> {
  const rows = connection
    .prepare("SELECT requirement, feature, status, updated_rev FROM requirement_status")
    .all();
  const stored = new Map<string, StoredStatus>();
  for (const row of rows) {
    stored.set(text(row.requirement, "requirement"), {
      feature: nullableText(row.feature),
      status: requirementStatus(row.status),
      updatedRev: integer(row.updated_rev, "updated_rev"),
    });
  }
  return stored;
}

interface StatusStatements {
  readonly insert: ReadModelStatement;
  readonly remove: ReadModelStatement;
  readonly touch: ReadModelStatement;
  readonly bounce: ReadModelStatement;
  readonly replace: ReadModelStatement;
}

function statusStatements(connection: ReadModelDatabase): StatusStatements {
  return {
    insert: connection.prepare(
      `INSERT INTO requirement_status(requirement, feature, status, updated_rev)
       VALUES (?, ?, ?, ?)`,
    ),
    remove: connection.prepare("DELETE FROM requirement_status WHERE requirement = ?"),
    touch: connection.prepare(
      "UPDATE requirement_status SET updated_rev = ? WHERE requirement = ?",
    ),
    bounce: connection.prepare(
      "UPDATE requirement_status SET status = ?, updated_rev = ? WHERE requirement = ?",
    ),
    replace: connection.prepare(
      `UPDATE requirement_status
          SET feature = ?, status = ?, updated_rev = ?
        WHERE requirement = ?`,
    ),
  };
}

function writeStatus(
  statements: StatusStatements,
  current: StoredStatus | undefined,
  next: RecomputedRequirement,
  updatedRev: number,
): void {
  if (!current) {
    statements.insert.run([next.requirement, next.feature, next.status, updatedRev]);
    return;
  }
  if (current.status === next.status && current.feature === next.feature) {
    if (current.updatedRev !== updatedRev) {
      statements.touch.run([updatedRev, next.requirement]);
    }
    return;
  }
  if (current.status === next.status) {
    const bounce: RequirementStatusName = current.status === "pending" ? "failing" : "pending";
    statements.bounce.run([bounce, updatedRev, next.requirement]);
    statements.replace.run([next.feature, next.status, updatedRev, next.requirement]);
    return;
  }
  statements.replace.run([next.feature, next.status, updatedRev, next.requirement]);
}
