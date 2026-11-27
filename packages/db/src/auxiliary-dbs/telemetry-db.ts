import {
  lookupNamedQuery,
  ReaderPool,
  type DbHandle,
  type SqliteConnection as DriverSqliteConnection,
} from "../driver/index.js";
import { AuxiliaryDbError, InvalidTelemetryEventError } from "./errors.js";
import { createStderrAuxiliaryLogger } from "./logger.js";
import { assertSafeInteger, optionalText, requiredInt, requiredText } from "./rows.js";
import { openResilientDatabase } from "./resilient-open.js";
import {
  assertConnectionIsolated,
  isSqliteCorruption,
  type SqliteConnection,
} from "./sqlite-connection.js";
import {
  TELEMETRY_KINDS,
  type AuxiliaryLogger,
  type TelemetryEnqueueResult,
  type TelemetryEventInput,
  type TelemetryKind,
  type TelemetryRecord,
  type TelemetryStats,
} from "./types.js";

export const TELEMETRY_QUEUE_CAP = 2_000;
export const TELEMETRY_FLUSH_ROWS = 200;
export const TELEMETRY_FLUSH_INTERVAL_MS = 250;
export const TELEMETRY_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
export const TELEMETRY_PAGE_LIMIT = 500;
const IDLE_PRUNE_MS = 60_000;

const NOISY_KINDS = new Set<TelemetryKind>(["progress", "heartbeat"]);

interface QueuedTelemetry {
  readonly attempt: string | null;
  readonly ts: number;
  readonly kind: TelemetryKind;
  readonly data: string;
}

export interface OpenTelemetryDbOptions {
  readonly filePath: string;
  readonly logger?: AuxiliaryLogger;
  readonly now?: () => number;
  readonly queueCap?: number;
  readonly flushIntervalMs?: number;
}

export interface TelemetryConnectionSettings {
  readonly journalMode: string;
  readonly synchronous: string;
}

export class TelemetryDb implements DbHandle {
  private closed = false;
  private readersPool: ReaderPool | undefined;
  private readonly queue: QueuedTelemetry[] = [];
  private dropped = 0;
  private flushed = 0;
  private flushTransactions = 0;
  private lastPruneAt = 0;
  private immediate: NodeJS.Immediate | undefined;
  private readonly timer: NodeJS.Timeout;
  private readonly cap: number;
  private readonly now: () => number;

  private constructor(
    private readonly conn: SqliteConnection,
    readonly filePath: string,
    now: () => number,
    queueCap: number,
    flushIntervalMs: number,
  ) {
    this.now = now;
    this.cap = queueCap;
    this.pruneRetention(now());
    this.timer = setInterval(() => {
      this.onTimer();
    }, flushIntervalMs);
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  static open(options: OpenTelemetryDbOptions): TelemetryDb {
    const logger = options.logger ?? createStderrAuxiliaryLogger();
    const now = options.now ?? Date.now;
    const queueCap = options.queueCap ?? TELEMETRY_QUEUE_CAP;
    const flushIntervalMs = options.flushIntervalMs ?? TELEMETRY_FLUSH_INTERVAL_MS;
    if (!Number.isInteger(queueCap) || queueCap < 1) {
      throw new InvalidTelemetryEventError("queue cap must be a positive integer");
    }
    if (!Number.isInteger(flushIntervalMs) || flushIntervalMs < 1) {
      throw new InvalidTelemetryEventError("flush interval must be a positive integer");
    }
    const conn = openResilientDatabase({
      filePath: options.filePath,
      profile: "telemetry",
      schema: "telemetry",
      requiredTable: "telemetry",
      logger,
      rebuildCode: "telemetry_db_rebuilt",
      rebuildMessage:
        "telemetry.db was corrupt and was recreated. Telemetry is lossy, so only detail was lost.",
    });
    return new TelemetryDb(conn, options.filePath, now, queueCap, flushIntervalMs);
  }

  get writer(): DriverSqliteConnection {
    this.assertOpen();
    return this.conn.driver;
  }

  get readers(): ReaderPool {
    this.assertOpen();
    if (this.readersPool === undefined) {
      this.readersPool = new ReaderPool({
        location: this.filePath,
        role: "telemetry",
        size: 2,
        lazy: true,
      });
    }
    return this.readersPool;
  }

  query(name: string): string {
    this.assertOpen();
    return lookupNamedQuery(name);
  }

  enqueue(input: TelemetryEventInput): TelemetryEnqueueResult {
    this.assertOpen();
    const event = normalizeEvent(input);
    let droppedNow = 0;
    if (this.queue.length >= this.cap) {
      if (NOISY_KINDS.has(event.kind)) {
        if (!this.shedOldestNoisy()) {
          this.dropped += 1;
          return { accepted: false, dropped: 1 };
        }
        this.dropped += 1;
        droppedNow += 1;
      } else if (this.shedOldestNoisy()) {
        this.dropped += 1;
        droppedNow += 1;
      } else {
        this.queue.shift();
        this.dropped += 1;
        droppedNow += 1;
      }
    }
    this.queue.push(event);
    if (this.queue.length >= TELEMETRY_FLUSH_ROWS) this.scheduleFlush();
    return { accepted: true, dropped: droppedNow };
  }

  flush(): number {
    this.assertOpen();
    const written = this.flushQueued();
    if (written === 0) this.pruneRetention(this.now());
    return written;
  }

  pruneRetention(now = this.now()): number {
    this.assertOpen();
    const cutoff = now - TELEMETRY_RETENTION_MS;
    const result = this.conn.runImmediate(() =>
      this.conn.run("DELETE FROM telemetry WHERE ts < ?", cutoff),
    );
    this.lastPruneAt = now;
    return result.changes;
  }

  count(): number {
    this.assertOpen();
    return scalar(this.conn, "SELECT COUNT(*) AS c FROM telemetry");
  }

  countByKind(kind: TelemetryKind): number {
    this.assertOpen();
    assertKind(kind);
    return scalar(this.conn, "SELECT COUNT(*) AS c FROM telemetry WHERE kind = ?", kind);
  }

  readPage(options: { readonly limit?: number; readonly afterId?: number } = {}): readonly TelemetryRecord[] {
    this.assertOpen();
    const limit = clampPageLimit(options.limit ?? TELEMETRY_PAGE_LIMIT);
    const afterId = options.afterId ?? 0;
    assertSafeInteger(afterId, "afterId");
    return this.conn
      .all(
        `SELECT id, attempt, ts, kind, data
         FROM telemetry
         WHERE id > ?
         ORDER BY id
         LIMIT ?`,
        afterId,
        limit,
      )
      .map((row) => mapRecord(row));
  }

  stats(): TelemetryStats {
    this.assertOpen();
    return {
      queued: this.queue.length,
      dropped: this.dropped,
      flushed: this.flushed,
      flushTransactions: this.flushTransactions,
    };
  }

  schemaTables(): readonly string[] {
    this.assertOpen();
    return this.conn
      .all(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name`,
      )
      .map((row) => requiredText(row, "name"));
  }

  connectionSettings(): TelemetryConnectionSettings {
    this.assertOpen();
    const synchronous = this.conn.readPragma("synchronous");
    return {
      journalMode: String(this.conn.readPragma("journal_mode") ?? "").toLowerCase(),
      synchronous:
        synchronous === 1 || synchronous === "1" || synchronous === "normal" ? "normal" : String(synchronous),
    };
  }

  attachedDatabaseNames(): readonly string[] {
    this.assertOpen();
    return this.conn.databaseNames().filter((name) => name !== "temp");
  }

  verifyIsolatedConnection(): void {
    this.assertOpen();
    assertConnectionIsolated(this.conn);
  }

  close(): void {
    if (this.closed) return;
    clearInterval(this.timer);
    if (this.immediate !== undefined) clearImmediate(this.immediate);
    this.immediate = undefined;
    const readers = this.readersPool;
    this.readersPool = undefined;
    if (readers) void readers.close();
    try {
      this.flushQueued();
      try {
        this.conn.close({ skipCheckpoint: this.conn.inTransaction() });
      } catch (error) {
        if (!isSqliteCorruption(error)) throw error;
      }
    } finally {
      this.closed = true;
      this.conn.close({ skipCheckpoint: true });
    }
  }

  private onTimer(): void {
    if (this.closed) return;
    const written = this.flushQueued();
    if (written === 0 && this.now() - this.lastPruneAt >= IDLE_PRUNE_MS) {
      this.pruneRetention(this.now());
    }
  }

  private scheduleFlush(): void {
    if (this.immediate !== undefined || this.closed) return;
    const handle = setImmediate(() => {
      this.immediate = undefined;
      if (!this.closed) this.flushQueued();
    });
    if (typeof handle.unref === "function") handle.unref();
    this.immediate = handle;
  }

  private flushQueued(): number {
    let written = 0;
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, TELEMETRY_FLUSH_ROWS);
      try {
        this.conn.runImmediate(() => {
          const statement = this.conn.prepare(
            "INSERT INTO telemetry(attempt, ts, kind, data) VALUES (?, ?, ?, ?)",
          );
          try {
            for (const row of batch) {
              statement.run(row.attempt, row.ts, row.kind, row.data);
            }
          } finally {
            statement.finalize?.();
          }
        });
      } catch (error) {
        this.queue.unshift(...batch);
        throw error;
      }
      written += batch.length;
      this.flushTransactions += 1;
    }
    if (written > 0) {
      this.flushed += written;
      this.pruneRetention(this.now());
    }
    return written;
  }

  private shedOldestNoisy(): boolean {
    const index = this.queue.findIndex((event) => NOISY_KINDS.has(event.kind));
    if (index < 0) return false;
    this.queue.splice(index, 1);
    return true;
  }

  private assertOpen(): void {
    if (this.closed) throw new AuxiliaryDbError("TELEMETRY_CLOSED", "telemetry database is closed");
  }
}

function normalizeEvent(input: TelemetryEventInput): QueuedTelemetry {
  assertKind(input.kind);
  assertSafeInteger(input.ts, "ts");
  const attempt =
    input.attempt === undefined || input.attempt === null || input.attempt.trim().length === 0
      ? null
      : input.attempt;
  let data: string;
  try {
    data = JSON.stringify(input.data);
  } catch (error) {
    throw new InvalidTelemetryEventError(error instanceof Error ? error.message : "telemetry data is not JSON");
  }
  if (typeof data !== "string") throw new InvalidTelemetryEventError("telemetry data is not JSON");
  return { attempt, ts: input.ts, kind: input.kind, data };
}

function assertKind(kind: string): asserts kind is TelemetryKind {
  if (!(TELEMETRY_KINDS as readonly string[]).includes(kind)) {
    throw new InvalidTelemetryEventError(`unknown telemetry kind ${kind}`);
  }
}

function clampPageLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new InvalidTelemetryEventError("page limit must be a positive integer");
  }
  return Math.min(limit, TELEMETRY_PAGE_LIMIT);
}

function scalar(connection: SqliteConnection, sql: string, ...params: Array<string | number>): number {
  const row = connection.get(sql, ...params);
  if (row === undefined) return 0;
  return requiredInt(row, "c");
}

function mapRecord(row: Parameters<typeof requiredText>[0]): TelemetryRecord {
  const kind = requiredText(row, "kind");
  assertKind(kind);
  return {
    id: requiredInt(row, "id"),
    attempt: optionalText(row, "attempt"),
    ts: requiredInt(row, "ts"),
    kind,
    data: JSON.parse(requiredText(row, "data")) as unknown,
  };
}
