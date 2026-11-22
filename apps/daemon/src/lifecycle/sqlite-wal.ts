import type { SQLOutputValue } from "node:sqlite";
import type { SqliteCheckpointPort } from "./ports.js";
import type { WalCheckpointMode, WalCheckpointResult } from "./protocol.js";

export interface SqliteStatementHost {
  prepare(sql: string): { get(): Record<string, SQLOutputValue> | undefined };
}

function asCount(value: SQLOutputValue | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  throw new Error("wal_checkpoint returned a non-numeric column");
}

export function parseWalCheckpointRow(
  row: Record<string, SQLOutputValue> | undefined,
): WalCheckpointResult {
  if (!row) throw new Error("wal_checkpoint returned no row");
  const values = Object.values(row);
  const busy = values[0];
  const log = values[1];
  const checkpointed = values[2];
  if (busy === undefined || log === undefined || checkpointed === undefined) {
    throw new Error("wal_checkpoint row is incomplete");
  }
  return { busy: asCount(busy), log: asCount(log), checkpointed: asCount(checkpointed) };
}

const WAL_SQL = {
  PASSIVE: "PRAGMA wal_checkpoint(PASSIVE)",
  TRUNCATE: "PRAGMA wal_checkpoint(TRUNCATE)",
} as const;

export function runWalCheckpoint(db: SqliteStatementHost, mode: WalCheckpointMode): WalCheckpointResult {
  return parseWalCheckpointRow(db.prepare(WAL_SQL[mode]).get());
}

export class NodeSqliteCheckpoint implements SqliteCheckpointPort {
  readonly modes: WalCheckpointMode[] = [];

  constructor(private readonly db: SqliteStatementHost) {}

  async walCheckpoint(mode: WalCheckpointMode): Promise<WalCheckpointResult> {
    this.modes.push(mode);
    return runWalCheckpoint(this.db, mode);
  }
}

export class RecordingSqlite implements SqliteCheckpointPort {
  readonly modes: WalCheckpointMode[] = [];

  async walCheckpoint(mode: WalCheckpointMode): Promise<WalCheckpointResult> {
    this.modes.push(mode);
    return { busy: 0, log: 0, checkpointed: 1 };
  }
}
