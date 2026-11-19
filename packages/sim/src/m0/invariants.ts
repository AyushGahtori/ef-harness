import type { ClientSnapshot, ClientStateSyncer } from "./client-sync.js";
import type { DbHandle, KernelSession } from "./kernel-session.js";
import { asNumber, asString, type SqlRow } from "./schema-cache.js";

export interface LeaseInterval {
  task: string;
  attempt: string;
  start: number;
  end: number | null;
}

export interface PruneRecord {
  id: string;
  fullyAcked: boolean;
}

export interface InvariantInput {
  session: KernelSession;
  clients: ReadonlyMap<string, ClientStateSyncer>;
  snapshots: ReadonlyMap<string, ClientSnapshot>;
  committedCandidates: readonly string[];
  expectedTasks: ReadonlyMap<string, number>;
  leases: readonly LeaseInterval[];
  pruned: readonly PruneRecord[];
}

function valuesOf(row: SqlRow): SqlRow[string][] {
  return Object.values(row);
}

function quickCheckClean(rows: SqlRow[]): boolean {
  return rows.length > 0 && rows.every((row) => valuesOf(row).every((value) => value === "ok"));
}

function leaseOverlaps(leases: readonly LeaseInterval[]): string[] {
  const grouped = new Map<string, LeaseInterval[]>();
  for (const lease of leases) {
    const list = grouped.get(lease.task) ?? [];
    list.push(lease);
    grouped.set(lease.task, list);
  }
  const errors: string[] = [];
  for (const [task, list] of grouped) {
    const sorted = [...list].sort((left, right) => left.start - right.start || left.attempt.localeCompare(right.attempt));
    for (let i = 1; i < sorted.length; i += 1) {
      const previous = sorted[i - 1];
      const next = sorted[i];
      if (!previous || !next) continue;
      const previousEnd = previous.end ?? Number.POSITIVE_INFINITY;
      if (next.start < previousEnd) errors.push(`overlapping lease on ${task}`);
    }
  }
  return errors;
}

function budgetErrors(session: KernelSession, handle: DbHandle): string[] {
  const rows = session.rows(
    handle,
    `SELECT b.scope_kind AS scope_kind, b.scope_id AS scope_id, b.currency AS currency,
            b.spent_units AS spent_units, b.reserved_units AS reserved_units,
            coalesce((
              SELECT sum(CASE r.state
                       WHEN 'settled' THEN coalesce(r.actual_units, 0)
                       WHEN 'held' THEN r.amount_units
                       WHEN 'unknown' THEN r.amount_units
                       ELSE 0 END)
                FROM reservation_scopes s
                JOIN reservations r ON r.id = s.reservation
               WHERE s.scope_kind = b.scope_kind AND s.scope_id = b.scope_id AND s.currency = b.currency
            ), 0) AS from_rows
       FROM budgets b`,
  );
  const errors: string[] = [];
  for (const row of rows) {
    const spent = asNumber(row.spent_units, "spent_units");
    const reserved = asNumber(row.reserved_units, "reserved_units");
    const fromRows = asNumber(row.from_rows, "from_rows");
    if (spent + reserved !== fromRows) {
      errors.push(
        `budget ${asString(row.scope_kind, "scope_kind")}:${asString(row.scope_id, "scope_id")} spent+reserved ${spent + reserved} != reservations ${fromRows}`,
      );
    }
  }
  return errors;
}

function grantErrors(session: KernelSession): string[] {
  const errors: string[] = [];
  const grants = session.rows(
    session.global,
    "SELECT id, project, units, state, used_units, unknown_units FROM grants ORDER BY id",
  );
  let unitSum = 0;
  for (const grant of grants) {
    const id = asString(grant.id, "id");
    const projectId = asString(grant.project, "project");
    const units = asNumber(grant.units, "units");
    const state = asString(grant.state, "state");
    unitSum += units;
    const project = session.projects.find((item) => item.id === projectId);
    if (!project) {
      errors.push(`grant ${id} has no state database`);
      continue;
    }
    const receipt = session.row(
      project,
      "SELECT units, used_units, unknown_units, closed_at FROM grant_receipts WHERE grant_id = ?",
      id,
    );
    const budget = session.row(
      project,
      "SELECT spent_units, reserved_units FROM budgets WHERE scope_kind = 'grant' AND scope_id = ?",
      id,
    );
    if (state === "expired") {
      const used = grant.used_units === null ? null : asNumber(grant.used_units, "used_units");
      if (used !== units) errors.push(`expired grant ${id} was not counted in full`);
      if (receipt) errors.push(`expired grant ${id} still has a project receipt`);
    } else if (state === "closed") {
      if (!receipt) {
        errors.push(`closed grant ${id} has no receipt`);
      } else {
        const used = asNumber(grant.used_units, "used_units");
        const unknown = grant.unknown_units === null ? 0 : asNumber(grant.unknown_units, "unknown_units");
        const receiptUsed = receipt.used_units === null ? 0 : asNumber(receipt.used_units, "used_units");
        const receiptUnknown = receipt.unknown_units === null ? 0 : asNumber(receipt.unknown_units, "unknown_units");
        if (used !== receiptUsed || unknown !== receiptUnknown) {
          errors.push(`grant ${id} broker totals do not match the project receipt`);
        }
      }
      if (budget) {
        const spent = asNumber(budget.spent_units, "spent_units");
        const reserved = asNumber(budget.reserved_units, "reserved_units");
        if (receipt) {
          const receiptUsed = receipt.used_units === null ? 0 : asNumber(receipt.used_units, "used_units");
          const receiptUnknown = receipt.unknown_units === null ? 0 : asNumber(receipt.unknown_units, "unknown_units");
          if (spent !== receiptUsed || reserved !== receiptUnknown) {
            errors.push(`grant ${id} budget does not match its receipt`);
          }
        }
      }
    } else {
      errors.push(`grant ${id} left in state ${state}`);
    }
    if (budget && state !== "expired") {
      const spent = asNumber(budget.spent_units, "spent_units");
      const reserved = asNumber(budget.reserved_units, "reserved_units");
      if (spent + reserved < 0) errors.push(`negative grant budget ${id}`);
    }
  }
  const window = session.row(
    session.global,
    "SELECT limit_units, estimated_units FROM connection_windows WHERE connection = 'conn-1' AND window_kind = '5h' AND window_start = 0",
  );
  if (!window) {
    errors.push("missing connection window");
  } else {
    const estimated = asNumber(window.estimated_units, "estimated_units");
    const limit = asNumber(window.limit_units, "limit_units");
    if (estimated !== unitSum) errors.push(`window estimated ${estimated} != grant units ${unitSum}`);
    if (estimated > limit) errors.push("connection window is over-promised");
  }
  return errors;
}

/** The nine M0 kernel invariants, evaluated against the live databases. */
export function checkInvariants(input: InvariantInput): string[] {
  const errors: string[] = [];
  const { session } = input;

  for (const handle of session.projects) {
    for (const id of input.committedCandidates) {
      if (!id.startsWith(`${handle.id}-`)) continue;
      const row = session.row(handle, "SELECT id FROM candidates WHERE id = ?", id);
      if (!row) errors.push(`lost candidate ${id}`);
    }
    const tasks = session.rows(handle, "SELECT task FROM task_runtime");
    const expected = input.expectedTasks.get(handle.id);
    if (expected !== undefined && tasks.length !== expected) {
      errors.push(`${handle.id} task count ${tasks.length} != ${expected}`);
    }

    const duplicateRunning = session.rows(
      handle,
      "SELECT task, count(*) AS c FROM attempts WHERE state = 'running' GROUP BY task HAVING c > 1",
    );
    if (duplicateRunning.length > 0) errors.push(`${handle.id} has two running attempts for one task`);

    const staleAccepted = session.rows(
      handle,
      `SELECT t.task AS task FROM task_runtime t
        WHERE t.state = 'ACCEPTED' AND t.holder_attempt IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM read_sets rs
            JOIN nodes n ON n.id = rs.node
           WHERE rs.attempt = t.holder_attempt AND n.version > rs.version
             AND EXISTS (
               SELECT 1 FROM node_changes c
                WHERE c.id = rs.node AND c.new_version > rs.version AND c.class IN ('breaking', 'retired')
             )
          )`,
    );
    if (staleAccepted.length > 0) errors.push(`${handle.id} accepted a stale read set`);

    const badEpoch = session.rows(
      handle,
      `SELECT c.id AS id FROM candidates c
         JOIN attempts a ON a.id = c.attempt
         JOIN task_runtime t ON t.task = c.task
        WHERE t.state = 'ACCEPTED' AND t.holder_attempt = c.attempt
          AND (a.state = 'fenced' OR a.epoch <> t.epoch OR c.epoch <> t.epoch)`,
    );
    if (badEpoch.length > 0) errors.push(`${handle.id} accepted a fenced or stale epoch`);

    const unresolved = session.rows(
      handle,
      `SELECT a.id AS id FROM attempts a
        WHERE a.state NOT IN ('fenced', 'rejected', 'accepted')
          AND EXISTS (
            SELECT 1 FROM read_sets rs
            JOIN nodes n ON n.id = rs.node
           WHERE rs.attempt = a.id AND n.version > rs.version
             AND EXISTS (
               SELECT 1 FROM node_changes ch
                WHERE ch.id = rs.node AND ch.new_version > rs.version AND ch.class IN ('breaking', 'retired')
             )
          )`,
    );
    if (unresolved.length > 0) errors.push(`${handle.id} left a stale worker unfenced and unreverified`);

    const duplicateAccepted = session.rows(
      handle,
      `SELECT t.task AS task, count(*) AS c
         FROM task_runtime t
         JOIN candidates c ON c.task = t.task AND c.attempt = t.holder_attempt
        WHERE t.state = 'ACCEPTED'
        GROUP BY t.task
       HAVING c > 1`,
    );
    if (duplicateAccepted.length > 0) errors.push(`${handle.id} duplicated an accepted candidate`);

    const drift = session.all(handle, "rollup_drift");
    if (drift.length > 0) errors.push(`${handle.id} rollup_drift is not empty`);

    const deliveryLess = session.all(handle, "outbox_without_deliveries");
    if (deliveryLess.length > 0) errors.push(`${handle.id} has an outbox event with no deliveries`);

    const quick = session.rows(handle, "PRAGMA quick_check") ;
    if (!quickCheckClean(quick)) errors.push(`${handle.id} quick_check is not clean`);
    const foreignKeys = session.rows(handle, "PRAGMA foreign_key_check");
    if (foreignKeys.length > 0) errors.push(`${handle.id} foreign_key_check is not clean`);
    errors.push(...budgetErrors(session, handle));

    const client = input.clients.get(handle.id);
    const snapshot = input.snapshots.get(handle.id);
    if (!client || !snapshot) {
      errors.push(`${handle.id} is missing a client window`);
    } else {
      errors.push(...client.parityErrors(snapshot).map((line) => `${handle.id} ${line}`));
    }
  }

  const globalQuick = session.rows(session.global, "PRAGMA quick_check");
  if (!quickCheckClean(globalQuick)) errors.push("global quick_check is not clean");
  const globalFk = session.rows(session.global, "PRAGMA foreign_key_check");
  if (globalFk.length > 0) errors.push("global foreign_key_check is not clean");
  errors.push(...grantErrors(session));
  errors.push(...leaseOverlaps(input.leases));
  for (const pruned of input.pruned) {
    if (!pruned.fullyAcked) errors.push(`pruned unacknowledged outbox event ${pruned.id}`);
  }
  return errors;
}
