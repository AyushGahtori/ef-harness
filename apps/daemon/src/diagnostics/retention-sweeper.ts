import {
  fileByteSize,
  openTelemetryDatabase,
  readNumberField,
  readTextField,
  type TelemetrySession,
  type TelemetryStatement,
} from "./telemetry-db.js";
import { parseHardwareRows, parseSqliteWrite } from "./telemetry-parse.js";
import { percentileNearestRank } from "./percentile.js";
import {
  DAILY_AGGREGATE_RETENTION_MS,
  HARDWARE_SAMPLE_RETENTION_MS,
  type PressureLevel,
} from "./types.js";

const SAMPLE_KINDS = ["hw_1hz", "hw_minute", "sqlite_write", "provider", "worker"] as const;

export interface RetentionSweepResult {
  readonly prunedSamples: number;
  readonly dailyAggregates: number;
  readonly bytes: number;
}

interface DayBucket {
  samples: number;
  ram: number;
  commit: number;
  diskProject: number;
  diskApp: number;
  av: number;
  ui: number;
  pressure: PressureLevel;
}

interface SqliteDayBucket {
  latencies: number[];
  busyRetries: number;
}

export class TelemetryRetentionSweeper {
  constructor(
    private readonly path: string,
    private readonly clock: () => number = Date.now,
  ) {}

  sweep(): RetentionSweepResult {
    const now = this.clock();
    const sampleCutoff = now - HARDWARE_SAMPLE_RETENTION_MS;
    const dailyCutoff = now - DAILY_AGGREGATE_RETENTION_MS;
    const database = openTelemetryDatabase(this.path, false);
    let prunedSamples = 0;
    try {
      database.exec("BEGIN IMMEDIATE");
      const rows = database
        .prepare(
          `SELECT id, ts, kind, data FROM telemetry WHERE ts < ? AND kind IN (${SAMPLE_KINDS.map(() => "?").join(", ")})`,
        )
        .all(sampleCutoff, ...SAMPLE_KINDS);
      const hardwareDays = new Map<number, DayBucket>();
      const sqliteDays = new Map<number, SqliteDayBucket>();
      const ids: number[] = [];
      for (const row of rows) {
        const id = readNumberField(row, "id");
        const ts = readNumberField(row, "ts");
        const kind = readTextField(row, "kind");
        const data = readTextField(row, "data");
        if (id === null || ts === null || kind === null || data === null) continue;
        ids.push(id);
        if (kind === "hw_1hz" || kind === "hw_minute") {
          foldHardware(hardwareDays, ts, kind, data);
        } else if (kind === "sqlite_write") {
          foldSqlite(sqliteDays, ts, data);
        }
      }
      const insert = database.prepare(
        "INSERT INTO telemetry (attempt, ts, kind, data) VALUES (?, ?, ?, ?)",
      );
      for (const [day, bucket] of hardwareDays) {
        upsertDaily(database, insert, day, "hw_daily", hardwareDaily(day, bucket));
      }
      for (const [day, bucket] of sqliteDays) {
        upsertDaily(database, insert, day, "sqlite_daily", sqliteDaily(day, bucket));
      }
      if (ids.length > 0) {
        const placeholders = ids.map(() => "?").join(", ");
        const deleted = database
          .prepare(`DELETE FROM telemetry WHERE id IN (${placeholders})`)
          .run(...ids);
        prunedSamples = Number(deleted.changes);
      }
      database
        .prepare("DELETE FROM telemetry WHERE ts < ? AND kind IN ('hw_daily', 'sqlite_daily')")
        .run(dailyCutoff);
      database.exec("COMMIT");
    } catch (error) {
      throw rollback(database, error);
    } finally {
      database.close();
    }
    const vacuum = openTelemetryDatabase(this.path, false);
    try {
      vacuum.exec("VACUUM");
    } finally {
      vacuum.close();
    }
    const countDb = openTelemetryDatabase(this.path, true);
    let dailyAggregates = 0;
    try {
      const row = countDb
        .prepare("SELECT COUNT(*) AS count FROM telemetry WHERE kind IN ('hw_daily', 'sqlite_daily')")
        .get();
      dailyAggregates = readNumberField(row, "count") ?? 0;
    } finally {
      countDb.close();
    }
    return {
      prunedSamples,
      dailyAggregates,
      bytes: fileByteSize(this.path),
    };
  }
}

function foldHardware(
  days: Map<number, DayBucket>,
  ts: number,
  kind: string,
  data: string,
): void {
  for (const sample of parseHardwareRows(kind, ts, data)) {
    const day = utcDayStart(sample.at);
    const current = days.get(day) ?? {
      samples: 0,
      ram: 0,
      commit: 0,
      diskProject: 0,
      diskApp: 0,
      av: 0,
      ui: 0,
      pressure: sample.pressure,
    };
    const next = current.samples + 1;
    days.set(day, {
      samples: next,
      ram: current.ram + sample.ramUsedBytes,
      commit: current.commit + sample.commitUsedBytes,
      diskProject: current.diskProject + sample.diskFreeProjectBytes,
      diskApp: current.diskApp + sample.diskFreeAppDataBytes,
      av: current.av + sample.avCpuPercent,
      ui: current.ui + sample.uiInputToPaintP95Ms,
      pressure: worsePressure(current.pressure, sample.pressure),
    });
  }
}

function foldSqlite(days: Map<number, SqliteDayBucket>, ts: number, data: string): void {
  const parsed = parseSqliteWrite(data);
  if (!parsed) return;
  const day = utcDayStart(ts);
  const current = days.get(day) ?? { latencies: [], busyRetries: 0 };
  current.latencies.push(parsed.latencyMs);
  current.busyRetries += parsed.busyRetries;
  days.set(day, current);
}

function upsertDaily(
  database: TelemetrySession,
  insert: TelemetryStatement,
  day: number,
  kind: string,
  data: string,
): void {
  const existing = database
    .prepare("SELECT id FROM telemetry WHERE kind = ? AND ts = ? LIMIT 1")
    .get(kind, day);
  const id = readNumberField(existing, "id");
  if (id === null) {
    insert.run(null, day, kind, data);
    return;
  }
  database.prepare("UPDATE telemetry SET data = ? WHERE id = ?").run(data, id);
}

function hardwareDaily(day: number, bucket: DayBucket): string {
  const samples = Math.max(1, bucket.samples);
  return JSON.stringify({
    dayStart: day,
    samples: bucket.samples,
    ramUsedAvg: bucket.ram / samples,
    commitUsedAvg: bucket.commit / samples,
    diskProjectAvg: bucket.diskProject / samples,
    diskAppAvg: bucket.diskApp / samples,
    avCpuAvg: bucket.av / samples,
    uiP95Avg: bucket.ui / samples,
    pressureMode: bucket.pressure,
  });
}

function sqliteDaily(day: number, bucket: SqliteDayBucket): string {
  const sorted = [...bucket.latencies].sort((left, right) => left - right);
  return JSON.stringify({
    dayStart: day,
    samples: sorted.length,
    p50Ms: percentileNearestRank(sorted, 50),
    p95Ms: percentileNearestRank(sorted, 95),
    p99Ms: percentileNearestRank(sorted, 99),
    busyRetries: bucket.busyRetries,
  });
}

function utcDayStart(ts: number): number {
  const date = new Date(ts);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function worsePressure(left: PressureLevel, right: PressureLevel): PressureLevel {
  const rank: Record<PressureLevel, number> = { Green: 0, Yellow: 1, Orange: 2, Red: 3 };
  return rank[right] > rank[left] ? right : left;
}

function rollback(database: TelemetrySession, error: unknown): Error {
  try {
    database.exec("ROLLBACK");
  } catch (rollbackError) {
    const original = error instanceof Error ? error.message : "retention sweep failed";
    const extra = rollbackError instanceof Error ? rollbackError.message : "rollback failed";
    return new Error(`${original}; ${extra}`);
  }
  return error instanceof Error ? error : new Error("retention sweep failed");
}
