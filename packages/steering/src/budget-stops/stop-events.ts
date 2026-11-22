import { DatabaseSync } from "node:sqlite";

import { BudgetStopError, type RecoveryActionId, type StopEventRecord, type StopTrigger } from "./types.js";

export const STOP_EVENTS_TABLE = "stop_events";

export const STOP_EVENTS_DDL = `
CREATE TABLE IF NOT EXISTS stop_events (
  id TEXT PRIMARY KEY NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('budget_100', 'window_exhausted', 'user_stop', 'disk_red')),
  timestamp_ms INTEGER NOT NULL,
  checkpoint_shas_json TEXT NOT NULL,
  recovery_option TEXT
);
`;

interface StopEventRow {
  id: string;
  trigger: string;
  timestamp_ms: number | bigint;
  checkpoint_shas_json: string;
  recovery_option: string | null;
}

/**
 * Local stand-in for `state.db.stop_events`.
 * The canonical schema file is frozen, so this DDL lives beside the store.
 */
export class StopEventStore {
  private readonly db: DatabaseSync;
  private nextId = 1;

  constructor(filename = ":memory:") {
    this.db = new DatabaseSync(filename);
    this.db.exec(STOP_EVENTS_DDL);
  }

  record(input: {
    readonly trigger: StopTrigger;
    readonly timestampMs: number;
    readonly checkpointShas: readonly string[];
    readonly recoveryOption: RecoveryActionId | null;
  }): StopEventRecord {
    const id = `stop-${this.nextId}`;
    this.nextId += 1;
    this.db
      .prepare(
        `INSERT INTO ${STOP_EVENTS_TABLE} (id, trigger, timestamp_ms, checkpoint_shas_json, recovery_option) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, input.trigger, input.timestampMs, JSON.stringify(input.checkpointShas), input.recoveryOption);
    return this.require(id);
  }

  setRecovery(id: string, recoveryOption: RecoveryActionId): StopEventRecord {
    const updated = this.db
      .prepare(`UPDATE ${STOP_EVENTS_TABLE} SET recovery_option = ? WHERE id = ?`)
      .run(recoveryOption, id);
    if (Number(updated.changes) !== 1) {
      throw new BudgetStopError("missing_stop_event", `unknown stop event ${id}`);
    }
    return this.require(id);
  }

  list(): readonly StopEventRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, trigger, timestamp_ms, checkpoint_shas_json, recovery_option FROM ${STOP_EVENTS_TABLE} ORDER BY timestamp_ms, id`,
      )
      .all() as unknown as StopEventRow[];
    return rows.map((row) => toRecord(row));
  }

  tableName(): string {
    const row = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(STOP_EVENTS_TABLE) as { name?: string } | undefined;
    if (!row?.name) throw new BudgetStopError("missing_stop_table", "stop_events table is missing");
    return row.name;
  }

  close(): void {
    this.db.close();
  }

  private require(id: string): StopEventRecord {
    const row = this.db
      .prepare(
        `SELECT id, trigger, timestamp_ms, checkpoint_shas_json, recovery_option FROM ${STOP_EVENTS_TABLE} WHERE id = ?`,
      )
      .get(id) as unknown as StopEventRow | undefined;
    if (!row) throw new BudgetStopError("missing_stop_event", `unknown stop event ${id}`);
    return toRecord(row);
  }
}

function toRecord(row: StopEventRow): StopEventRecord {
  const shas = JSON.parse(row.checkpoint_shas_json) as unknown;
  if (!Array.isArray(shas) || shas.some((item) => typeof item !== "string")) {
    throw new BudgetStopError("bad_stop_event", "checkpoint SHAs must be a string array");
  }
  return {
    id: row.id,
    trigger: row.trigger as StopEventRecord["trigger"],
    timestampMs: Number(row.timestamp_ms),
    checkpointShas: shas,
    recoveryOption: row.recovery_option as StopEventRecord["recoveryOption"],
  };
}
