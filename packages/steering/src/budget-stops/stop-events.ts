import type { ProjectStateDb } from "@ef-harness/db";

import { openPrivateProjectState } from "./state-handle.js";
import { BudgetStopError, type RecoveryActionId, type StopEventRecord, type StopTrigger } from "./types.js";

export const STOP_EVENTS_TABLE = "stop_events";

/**
 * Column list of the MigrationRunner v2 `stop_events` table.
 * The store does not execute this DDL. `openProjectStateDb` applies it.
 */
export const STOP_EVENTS_DDL = `
CREATE TABLE IF NOT EXISTS stop_events (
  id TEXT PRIMARY KEY,
  trigger TEXT NOT NULL CHECK (trigger IN ('budget_100','window_exhausted','user_stop','disk_red')),
  occurred_at INTEGER NOT NULL,
  checkpoint_shas TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(checkpoint_shas)),
  recovery_option TEXT
) STRICT, WITHOUT ROWID;
`;

interface StopEventRow {
  id: string;
  trigger: string;
  occurred_at: number | bigint;
  checkpoint_shas: string;
  recovery_option: string | null;
}

/**
 * `state.db.stop_events` through the open `ProjectStateDb` writer.
 * A bare constructor opens a private migrated database for unit tests.
 */
export class StopEventStore {
  private readonly db: ProjectStateDb;
  private readonly owns: boolean;
  private nextId: number;

  constructor(state?: ProjectStateDb) {
    if (state) {
      this.db = state;
      this.owns = false;
    } else {
      this.db = openPrivateProjectState("ef-stop-events");
      this.owns = true;
    }
    this.nextId = this.readNextId();
  }

  record(input: {
    readonly trigger: StopTrigger;
    readonly timestampMs: number;
    readonly checkpointShas: readonly string[];
    readonly recoveryOption: RecoveryActionId | null;
  }): StopEventRecord {
    const id = `stop-${this.nextId}`;
    this.nextId += 1;
    this.db.writer
      .prepare(
        `INSERT INTO ${STOP_EVENTS_TABLE} (id, trigger, occurred_at, checkpoint_shas, recovery_option) VALUES (?, ?, ?, ?, ?)`,
      )
      .run([id, input.trigger, input.timestampMs, JSON.stringify(input.checkpointShas), input.recoveryOption]);
    return this.require(id);
  }

  setRecovery(id: string, recoveryOption: RecoveryActionId): StopEventRecord {
    const updated = this.db.writer
      .prepare(`UPDATE ${STOP_EVENTS_TABLE} SET recovery_option = ? WHERE id = ?`)
      .run([recoveryOption, id]);
    if (Number(updated.changes) !== 1) {
      throw new BudgetStopError("missing_stop_event", `unknown stop event ${id}`);
    }
    return this.require(id);
  }

  list(): readonly StopEventRecord[] {
    const rows = this.db.writer
      .prepare(
        `SELECT id, trigger, occurred_at, checkpoint_shas, recovery_option FROM ${STOP_EVENTS_TABLE} ORDER BY occurred_at, id`,
      )
      .all() as StopEventRow[];
    return rows.map((row) => toRecord(row));
  }

  tableName(): string {
    const row = this.db.writer
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get([STOP_EVENTS_TABLE]) as { name?: string } | undefined;
    if (!row?.name) throw new BudgetStopError("missing_stop_table", "stop_events table is missing");
    return row.name;
  }

  close(): void {
    if (this.owns) this.db.close();
  }

  private readNextId(): number {
    const rows = this.db.writer.prepare(`SELECT id FROM ${STOP_EVENTS_TABLE}`).all() as Array<{ id?: string }>;
    let max = 0;
    for (const row of rows) {
      const match = /^stop-(\d+)$/.exec(row.id ?? "");
      if (!match?.[1]) continue;
      max = Math.max(max, Number(match[1]));
    }
    return max + 1;
  }

  private require(id: string): StopEventRecord {
    const row = this.db.writer
      .prepare(
        `SELECT id, trigger, occurred_at, checkpoint_shas, recovery_option FROM ${STOP_EVENTS_TABLE} WHERE id = ?`,
      )
      .get([id]) as StopEventRow | undefined;
    if (!row) throw new BudgetStopError("missing_stop_event", `unknown stop event ${id}`);
    return toRecord(row);
  }
}

function toRecord(row: StopEventRow): StopEventRecord {
  const shas = JSON.parse(row.checkpoint_shas) as unknown;
  if (!Array.isArray(shas) || shas.some((item) => typeof item !== "string")) {
    throw new BudgetStopError("bad_stop_event", "checkpoint SHAs must be a string array");
  }
  return {
    id: row.id,
    trigger: row.trigger as StopEventRecord["trigger"],
    timestampMs: Number(row.occurred_at),
    checkpointShas: shas,
    recoveryOption: row.recovery_option as StopEventRecord["recoveryOption"],
  };
}
