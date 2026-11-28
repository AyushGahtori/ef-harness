import type { SqlDb } from "../bootstrap/databases.js";

/**
 * Row shape consumed by the renderer `StateDbBoardRow` adapter.
 * Counts follow `ThreePoolCapacityScheduler.snapshot` (thinking width, warm
 * execution slots, waiters) without opening a second scheduler inside harnessd.
 * A 16 GB class is thinking 12 and warm execution 2.
 */
export interface StateDbHoldRow {
  readonly reason: string;
  readonly source: string;
  readonly summary: string;
}

export interface StateDbDependencyRow {
  readonly task: string;
  readonly title: string;
}

export interface StateDbBoardRow {
  readonly task: string;
  readonly feature: string;
  readonly state: string;
  readonly level: string;
  readonly holder_attempt: string | null;
  readonly submission_pending: 0 | 1;
  readonly title: string;
  readonly agent_id: string;
  readonly connection_id: string;
  readonly connection_label: string;
  readonly provider_id: string;
  readonly holds: readonly StateDbHoldRow[];
  readonly open_inbox_item: string | null;
  readonly inbox_need: string | null;
  readonly inbox_blocked_tasks: readonly string[];
  readonly blocked_by: readonly StateDbDependencyRow[];
  readonly merge_behind_count: number | null;
  readonly merge_behind_label: string | null;
  readonly activity: "none" | "feature_wiring" | "project_merge" | "verifying";
  readonly reviewer: string | null;
  readonly pool_phase: "thinking" | "waiting_for_run_slot" | "running_command" | null;
  readonly run_slot: number | null;
  readonly run_slot_capacity: number | null;
  readonly queue_position: number | null;
  readonly queue_blocker: string | null;
  readonly running_command: string | null;
  readonly elapsed_seconds: number | null;
  readonly verify_flow: string | null;
  readonly retry: number | null;
  readonly retry_max: number | null;
  readonly hint: number | null;
  readonly status_event: null;
  readonly requirement_count: number;
  readonly updated_at_ms: number;
  readonly accepted_label: string | null;
  readonly spend_label: string | null;
}

export interface ThreePoolCapacitySnapshot {
  readonly thinkingUsed: number;
  readonly thinkingCapacity: number;
  readonly runSlotsUsed: number;
  readonly runSlotsCapacity: number;
  readonly verifierRunSlots: number;
  readonly workerRunSlots: number;
  readonly runSlotQueueDepth: number;
  readonly mergeQueueIdle: boolean;
  readonly mergeQueueDetail: string;
}

export interface BoardProjection {
  readonly revision: number;
  readonly tasks: readonly StateDbBoardRow[];
  readonly capacity: ThreePoolCapacitySnapshot;
}

const THINKING_CAPACITY = 12;
const RUN_SLOT_CAPACITY = 2;

export function readBoardProjection(db: SqlDb): BoardProjection {
  const tasks = db
    .prepare(
      `SELECT t.task AS task, t.feature AS feature, t.state AS state, t.level AS level,
              t.holder_attempt AS holder_attempt, t.submission_pending AS submission_pending,
              t.updated_rev AS updated_rev, n.title AS title
         FROM task_runtime t
         JOIN nodes n ON n.id = t.task
        ORDER BY t.task`,
    )
    .all();
  const holds = group(db.prepare("SELECT task, reason, source FROM task_holds ORDER BY task, reason").all(), "task");
  const inbox = group(
    db
      .prepare(
        `SELECT s.task AS task, i.id AS id, i.kind AS kind
           FROM inbox_subscribers s
           JOIN inbox_items i ON i.id = s.item
          WHERE i.status = 'open'
          ORDER BY i.priority DESC, i.created_at`,
      )
      .all(),
    "task",
  );
  const subscribers = db.prepare("SELECT item, task FROM inbox_subscribers").all();
  const blocked = group(
    db
      .prepare(
        `SELECT e.src AS task, e.dst AS dep, d.title AS title
           FROM edges e
           JOIN nodes d ON d.id = e.dst
          WHERE e.type = 'depends_on' AND e.valid_to_rev IS NULL
          ORDER BY e.src, e.dst`,
      )
      .all(),
    "task",
  );
  const requirements = new Map<string, number>();
  for (const row of db
    .prepare(
      `SELECT src AS task, COUNT(*) AS n
         FROM edges
        WHERE type = 'implements' AND valid_to_rev IS NULL
        GROUP BY src`,
    )
    .all()) {
    requirements.set(text(row, "task"), number(row, "n"));
  }
  const attempts = new Map<string, Record<string, unknown>>();
  for (const row of db.prepare("SELECT id, connection, model FROM attempts").all()) {
    if (isRecord(row) && typeof row.id === "string") attempts.set(row.id, row);
  }

  let revision = 0;
  const projected: StateDbBoardRow[] = [];
  for (const raw of tasks) {
    const task = text(raw, "task");
    const updated = number(raw, "updated_rev");
    if (updated > revision) revision = updated;
    const state = text(raw, "state");
    const holder = nullableText(raw, "holder_attempt");
    const attempt = holder ? attempts.get(holder) : undefined;
    const connection = attempt ? textOr(attempt, "connection", "local") : "local";
    const provider = attempt ? textOr(attempt, "model", "local") : "local";
    const openInbox = inbox.get(task)?.[0];
    const itemId = openInbox ? text(openInbox, "id") : null;
    const blockedTasks =
      itemId === null
        ? []
        : subscribers
            .filter((row) => text(row, "item") === itemId && text(row, "task") !== task)
            .map((row) => text(row, "task"));
    projected.push({
      task,
      feature: text(raw, "feature"),
      state,
      level: text(raw, "level"),
      holder_attempt: holder,
      submission_pending: number(raw, "submission_pending") === 1 ? 1 : 0,
      title: text(raw, "title"),
      agent_id: connection,
      connection_id: connection,
      connection_label: connection,
      provider_id: provider,
      holds: (holds.get(task) ?? []).map((hold) => {
        const reason = text(hold, "reason");
        const source = text(hold, "source");
        return { reason, source, summary: `${reason} (${source})` };
      }),
      open_inbox_item: itemId,
      inbox_need: openInbox ? text(openInbox, "kind") : null,
      inbox_blocked_tasks: blockedTasks,
      blocked_by: (blocked.get(task) ?? []).map((edge) => ({
        task: text(edge, "dep"),
        title: text(edge, "title"),
      })),
      merge_behind_count: null,
      merge_behind_label: null,
      activity: state === "STATIC_AUDIT" || state === "CLEAN_VERIFY" ? "verifying" : "none",
      reviewer: null,
      pool_phase: state === "CODING" ? "thinking" : null,
      run_slot: null,
      run_slot_capacity: null,
      queue_position: null,
      queue_blocker: null,
      running_command: null,
      elapsed_seconds: null,
      verify_flow: null,
      retry: null,
      retry_max: null,
      hint: null,
      status_event: null,
      requirement_count: requirements.get(task) ?? 0,
      updated_at_ms: 0,
      accepted_label: null,
      spend_label: null,
    });
  }
  return { revision, tasks: projected, capacity: capacityFor(db, projected) };
}

function capacityFor(db: SqlDb, tasks: readonly StateDbBoardRow[]): ThreePoolCapacitySnapshot {
  let thinkingUsed = 0;
  let runSlotsUsed = 0;
  let verifierRunSlots = 0;
  let workerRunSlots = 0;
  let runSlotQueueDepth = 0;
  for (const task of tasks) {
    if (task.pool_phase === "thinking") thinkingUsed += 1;
    if (task.state === "CODING" || task.state === "STATIC_AUDIT" || task.state === "CLEAN_VERIFY") runSlotsUsed += 1;
    if (task.state === "STATIC_AUDIT" || task.state === "CLEAN_VERIFY") verifierRunSlots += 1;
    if (task.state === "CODING") workerRunSlots += 1;
    if (task.state === "READY") runSlotQueueDepth += 1;
  }
  const queued = mergeQueueCount(db);
  return {
    thinkingUsed,
    thinkingCapacity: THINKING_CAPACITY,
    runSlotsUsed,
    runSlotsCapacity: RUN_SLOT_CAPACITY,
    verifierRunSlots,
    workerRunSlots,
    runSlotQueueDepth,
    mergeQueueIdle: queued === 0,
    mergeQueueDetail: queued === 0 ? "" : `${String(queued)} queued`,
  };
}

function mergeQueueCount(db: SqlDb): number {
  const present = db
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'merge_queue_items'")
    .get();
  if (!isRecord(present)) return 0;
  const row = db.prepare("SELECT COUNT(*) AS n FROM merge_queue_items").get();
  return number(row, "n");
}

function group(rows: readonly unknown[], key: string): Map<string, Record<string, unknown>[]> {
  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = text(row, key);
    const list = grouped.get(id);
    if (list) list.push(row);
    else grouped.set(id, [row]);
  }
  return grouped;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(row: unknown, key: string): string {
  if (!isRecord(row)) throw new Error(`board row missing ${key}`);
  const value = row[key];
  if (typeof value !== "string") throw new Error(`board ${key} is not text`);
  return value;
}

function textOr(row: Record<string, unknown>, key: string, fallback: string): string {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function nullableText(row: unknown, key: string): string | null {
  if (!isRecord(row)) return null;
  const value = row[key];
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : null;
}

function number(row: unknown, key: string): number {
  if (!isRecord(row)) throw new Error(`board row missing ${key}`);
  const value = row[key];
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  throw new Error(`board ${key} is not a number`);
}
