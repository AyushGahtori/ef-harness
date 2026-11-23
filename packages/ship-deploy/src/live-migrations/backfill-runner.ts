import type { MigrationStateStore } from "./state-store.js";
import { adaptiveSleepMs, formatBackfillProgress, nextIntegerPk } from "./progress.js";
import { assertAssignExpression, assertBatchSize, quoteIdent } from "./sql-text.js";
import type { BackfillCheckpoint, BackfillSpec, SqlSession, SqlValue } from "./types.js";

export interface BackfillRunResult extends BackfillCheckpoint {
  updatedRows: number;
}

export function keysetPageSql(table: string, primaryKey: string, targetColumn: string): string {
  const pk = quoteIdent(primaryKey);
  const target = quoteIdent(targetColumn);
  return `SELECT ${pk} AS pk FROM ${quoteIdent(table)} WHERE ${target} IS NULL AND (? IS NULL OR ${pk} > ?) ORDER BY ${pk} LIMIT ?`;
}

export function backfillUpdateSql(spec: BackfillSpec): string {
  const expression = assertAssignExpression(spec.assignExpression);
  const target = quoteIdent(spec.targetColumn);
  return `UPDATE ${quoteIdent(spec.table)} SET ${target} = (${expression}) WHERE ${quoteIdent(spec.primaryKey)} = ? AND ${target} IS NULL`;
}

export class PausableBatchedBackfillRunner {
  updatedRows = 0;
  private pauseRequested = false;

  constructor(
    private readonly deps: {
      store: MigrationStateStore;
      sleep: (ms: number) => Promise<void>;
      now: () => number;
    },
  ) {}

  requestPause(): void {
    this.pauseRequested = true;
  }

  async run(input: {
    session: SqlSession;
    migrationId: string;
    spec: BackfillSpec;
    onProgress?: (snapshot: BackfillCheckpoint) => void;
    pauseWhen?: (snapshot: BackfillCheckpoint) => boolean;
  }): Promise<BackfillRunResult> {
    const batchSize = assertBatchSize(input.spec.batchSize);
    const selectSql = keysetPageSql(input.spec.table, input.spec.primaryKey, input.spec.targetColumn);
    const updateSql = backfillUpdateSql(input.spec);
    if (selectSql.includes("OFFSET") || updateSql.includes("OFFSET")) {
      throw new Error("backfill pagination must be keyset, never OFFSET");
    }
    const existing = this.deps.store.getCursor(input.migrationId, input.spec.id);
    const rowsTotal = existing?.rowsTotal ?? countAll(input.session, input.spec.table);
    let lastProcessedPk = existing?.lastProcessedPk ?? null;
    let batchErrors = [...(existing?.batchErrors ?? [])];
    let lastBatchMs = existing?.lastBatchMs ?? 0;
    let updatedRows = 0;

    while (!this.pauseRequested) {
      const page = input.session.all(selectSql, [pkParam(lastProcessedPk), pkParam(lastProcessedPk), batchSize]);
      if (page.length === 0) break;
      const started = this.deps.now();
      let batchPk: string | null = lastProcessedPk;
      input.session.exec("BEGIN IMMEDIATE");
      try {
        for (const row of page) {
          const pk = row.pk;
          if (pk === undefined) continue;
          const result = input.session.run(updateSql, [pk]);
          updatedRows += result.changes;
          this.updatedRows += result.changes;
          batchPk = String(pk);
        }
        input.session.exec("COMMIT");
      } catch (error) {
        rollback(input.session);
        const message = error instanceof Error ? error.message : String(error);
        batchErrors = [...batchErrors, message];
        const failed = this.checkpoint(input.spec, {
          lastProcessedPk,
          rowsTotal,
          remaining: countNulls(input.session, input.spec),
          batchErrors,
          paused: true,
          lastBatchMs,
        });
        this.deps.store.saveCursor(input.migrationId, failed);
        throw error;
      }
      lastProcessedPk = batchPk;
      lastBatchMs = Math.max(0, this.deps.now() - started);
      const remaining = countNulls(input.session, input.spec);
      const snapshot = this.checkpoint(input.spec, {
        lastProcessedPk,
        rowsTotal,
        remaining,
        batchErrors,
        paused: false,
        lastBatchMs,
      });
      this.deps.store.saveCursor(input.migrationId, snapshot);
      input.onProgress?.(snapshot);
      const delay = adaptiveSleepMs(lastBatchMs);
      if (delay > 0) await this.deps.sleep(delay);
      if (this.pauseRequested || input.pauseWhen?.(snapshot)) {
        const paused = { ...snapshot, paused: true };
        this.deps.store.saveCursor(input.migrationId, paused);
        return { ...paused, updatedRows };
      }
    }

    const finished = this.checkpoint(input.spec, {
      lastProcessedPk,
      rowsTotal,
      remaining: countNulls(input.session, input.spec),
      batchErrors,
      paused: this.pauseRequested,
      lastBatchMs,
    });
    this.deps.store.saveCursor(input.migrationId, finished);
    return { ...finished, updatedRows };
  }

  private checkpoint(
    spec: BackfillSpec,
    input: {
      lastProcessedPk: string | null;
      rowsTotal: number;
      remaining: number;
      batchErrors: readonly string[];
      paused: boolean;
      lastBatchMs: number;
    },
  ): BackfillCheckpoint {
    const rowsProcessed = Math.max(0, input.rowsTotal - input.remaining);
    return {
      backfillId: spec.id,
      lastProcessedPk: input.lastProcessedPk,
      nextPk: nextIntegerPk(input.lastProcessedPk),
      rowsProcessed,
      rowsRemainingEst: input.remaining,
      rowsTotal: input.rowsTotal,
      batchErrors: input.batchErrors,
      paused: input.paused,
      lastBatchMs: input.lastBatchMs,
      progressText: formatBackfillProgress({
        label: spec.label,
        rowsProcessed,
        rowsTotal: input.rowsTotal,
        batchMs: input.lastBatchMs,
      }),
    };
  }
}

function countAll(session: SqlSession, table: string): number {
  return readCount(session.get(`SELECT COUNT(*) AS c FROM ${quoteIdent(table)}`));
}

function countNulls(session: SqlSession, spec: BackfillSpec): number {
  return readCount(
    session.get(`SELECT COUNT(*) AS c FROM ${quoteIdent(spec.table)} WHERE ${quoteIdent(spec.targetColumn)} IS NULL`),
  );
}

function readCount(row: Record<string, SqlValue> | undefined): number {
  const value = row?.c;
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  throw new Error("expected a numeric count");
}

function pkParam(pk: string | null): SqlValue {
  if (pk === null) return null;
  if (/^-?\d+$/.test(pk)) return Number(pk);
  return pk;
}

function rollback(session: SqlSession): void {
  try {
    session.exec("ROLLBACK");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/no transaction/i.test(message)) throw error;
  }
}
