import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  DiagnosticsMetricsAggregator,
  TELEMETRY_SCHEMA_SQL,
  TELEMETRY_SIZE_BUDGET_BYTES,
  TELEMETRY_UNAVAILABLE_MESSAGE,
  TelemetryRetentionSweeper,
  rebuildTelemetryDatabase,
  type HardwareSample,
  type PoolUtilization,
} from "../../src/diagnostics/index.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "ef-diagnostics-"));
  directories.push(directory);
  return directory;
}

function pools(used: [number, number, number], capacity: [number, number, number]): HardwareSample["pools"] {
  const names = ["Thinking", "Warm execution", "Services"] as const;
  return [1, 2, 3].map((id, index) => ({
    id: id as 1 | 2 | 3,
    name: names[index] ?? `Pool ${id}`,
    used: used[index] ?? 0,
    capacity: capacity[index] ?? 0,
  })) as HardwareSample["pools"];
}

function sample(at: number, ramUsedBytes: number, pressure: HardwareSample["pressure"], slot: PoolUtilization["used"]): HardwareSample {
  return {
    at,
    ramUsedBytes,
    ramTotalBytes: 16_000,
    commitUsedBytes: ramUsedBytes + 100,
    commitLimitBytes: 32_000,
    diskFreeProjectBytes: 80_000_000_000,
    diskFreeAppDataBytes: 40_000_000_000,
    avCpuPercent: 4,
    uiInputToPaintP95Ms: 12,
    pressure,
    pools: pools([slot, slot, 0], [12, 4, 2]),
  };
}

function seed(path: string, rows: readonly { ts: number; kind: string; data: string }[]): void {
  rebuildTelemetryDatabase(path);
  const database = new DatabaseSync(path);
  const insert = database.prepare("INSERT INTO telemetry (attempt, ts, kind, data) VALUES (NULL, ?, ?, ?)");
  database.exec("BEGIN IMMEDIATE");
  for (const row of rows) insert.run(row.ts, row.kind, row.data);
  database.exec("COMMIT");
  database.close();
}

function markerDb(path: string, version: number, note: string): void {
  const database = new DatabaseSync(path);
  database.exec("PRAGMA journal_mode = WAL");
  database.exec(`PRAGMA user_version = ${version}`);
  database.exec("CREATE TABLE marker (id INTEGER PRIMARY KEY, note TEXT NOT NULL)");
  database.prepare("INSERT INTO marker (note) VALUES (?)").run(note);
  database.close();
}

describe("diagnostics metrics aggregator", () => {
  it("matches the frozen telemetry.db schema", () => {
    const schema = readFileSync(new URL("../../../../schema/telemetry.sql", import.meta.url), "utf8").replace(/--[^\n]*/g, "");
    expect(schema).toContain("CREATE TABLE telemetry");
    expect(TELEMETRY_SCHEMA_SQL).toContain("kind    TEXT NOT NULL");
    expect(TELEMETRY_SCHEMA_SQL).toContain("CREATE INDEX telemetry_ts ON telemetry(ts);");
    expect(schema.replaceAll(/\s+/g, " ")).toContain(
      "CREATE TABLE telemetry ( id INTEGER PRIMARY KEY, attempt TEXT, ts INTEGER NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL ) STRICT;",
    );
  });

  it("aggregates live and 24h sqlite, governor, pool, and CAS metrics", () => {
    const directory = tempDir();
    const telemetryPath = join(directory, "telemetry.db");
    const statePath = join(directory, "state.db");
    const globalPath = join(directory, "global.db");
    markerDb(statePath, 7, "state-marker");
    markerDb(globalPath, 3, "global-marker");
    writeFileSync(`${statePath}-wal`, Buffer.alloc(128, 7));
    const now = Date.UTC(2026, 10, 22, 15);
    const hour = 60 * 60 * 1000;
    const dbSample = sample(now - hour, 4_000, "Green", 1);
    const live = sample(now - 1_000, 5_000, "Yellow", 4);
    seed(telemetryPath, [
      { ts: now - 30 * hour, kind: "hw_1hz", data: JSON.stringify(sample(now - 30 * hour, 1, "Red", 9)) },
      { ts: dbSample.at, kind: "hw_1hz", data: JSON.stringify(dbSample) },
      { ts: now - 10, kind: "sqlite_write", data: JSON.stringify({ latencyMs: 10, busyRetries: 1 }) },
      { ts: now - 9, kind: "sqlite_write", data: JSON.stringify({ latencyMs: 12, busyRetries: 2 }) },
      { ts: now - 8, kind: "sqlite_write", data: JSON.stringify({ latencyMs: 14, busyRetries: 0 }) },
      { ts: now - 7, kind: "sqlite_write", data: JSON.stringify({ latencyMs: 16, busyRetries: 0 }) },
      { ts: now - 6, kind: "sqlite_write", data: JSON.stringify({ latencyMs: 18, busyRetries: 0 }) },
      { ts: now - 5, kind: "provider", data: JSON.stringify({ connectionId: "openai", latencyMs: 40, rateLimit429: 2, aimdConcurrency: 3 }) },
      { ts: now - 4, kind: "provider", data: JSON.stringify({ connectionId: "openai", latencyMs: 55, rateLimit429: 1, aimdConcurrency: 2 }) },
      { ts: now - 3, kind: "worker", data: JSON.stringify({ pass: 4, retry: 1, stuck: 1, loop: 0 }) },
      { ts: now - 2, kind: "worker", data: JSON.stringify({ pass: 1, retry: 2, stuck: 0, loop: 1 }) },
      { ts: now - 2, kind: "conformance", data: JSON.stringify({ adapterId: "codex", status: "pass", detail: "suite green" }) },
      { ts: now - 2, kind: "storage", data: JSON.stringify({ casBlobBytes: 4096, archivedZstdLogBytes: 2048, activeWorktreeCount: 3 }) },
      { ts: now - hour, kind: "backup", data: JSON.stringify({ verifiedAt: now - 5 * hour }) },
    ]);
    const aggregator = new DiagnosticsMetricsAggregator({
      telemetryPath,
      stateDbPath: statePath,
      globalDbPath: globalPath,
      ringBuffer: { readSince: () => [live] },
      pressure: { current: () => null, history: () => [] },
      footprints: {
        list: () => [{ commandClass: "playwright", peakRamMbP90: 1900, peakCpuMs: 400, wallClockMs: 12000 }],
      },
      backup: { lastVerifiedAt: () => now - hour },
      providers: { current: () => [] },
      conformance: { current: () => [] },
      storage: { current: () => null },
    });
    const snapshot = aggregator.aggregate(now);
    expect(snapshot.telemetryAvailable).toBe(true);
    expect(snapshot.writeLatency).toMatchObject({
      sampleCount: 5,
      p50Ms: 14,
      p95Ms: 18,
      p99Ms: 18,
      busyRetryCount: 3,
      sloMs: 50,
      withinSlo: true,
    });
    expect(snapshot.pools.map((pool) => pool.used)).toEqual([4, 4, 0]);
    expect(snapshot.storage).toEqual({ casBlobBytes: 4096, archivedZstdLogBytes: 2048, activeWorktreeCount: 3 });
    expect(snapshot.providers).toEqual([
      { connectionId: "openai", latencyMs: 55, rateLimit429: 3, aimdConcurrency: 2 },
    ]);
    expect(snapshot.workers).toEqual({ pass: 5, retry: 3, stuck: 1, loop: 1 });
    expect(snapshot.conformance).toEqual([{ adapterId: "codex", status: "pass", detail: "suite green" }]);
    expect(snapshot.footprints[0]?.commandClass).toBe("playwright");
    expect(snapshot.lastVerifiedBackupAt).toBe(now - hour);
    expect(snapshot.pressureHistory.map((point) => point.level)).toEqual(["Green", "Yellow"]);
    const ram = snapshot.sparklines.find((series) => series.id === "ram");
    expect(ram?.latest).toBe(5_000);
    expect(ram?.min).toBe(4_000);
    expect(ram?.points.length).toBeGreaterThan(0);
    const state = snapshot.databases.find((database) => database.name === "state.db");
    expect(state?.schemaVersion).toBe(7);
    expect(state?.walBytes).toBe(128);
    expect(state?.quickCheck).toBe("ok");
    expect(snapshot.databases.find((database) => database.name === "global.db")?.schemaVersion).toBe(3);
    expect(snapshot.databases.find((database) => database.name === "telemetry.db")?.bytes).toBeGreaterThan(0);
  });

  it("flags sqlite p99 at or above the 50 ms SLO", () => {
    const directory = tempDir();
    const telemetryPath = join(directory, "telemetry.db");
    const now = Date.UTC(2026, 10, 22, 15);
    seed(
      telemetryPath,
      [10, 20, 30, 40, 80].map((latencyMs, index) => ({
        ts: now - index,
        kind: "sqlite_write",
        data: JSON.stringify({ latencyMs, busyRetries: 0 }),
      })),
    );
    const snapshot = new DiagnosticsMetricsAggregator({
      telemetryPath,
      stateDbPath: join(directory, "missing-state.db"),
      globalDbPath: join(directory, "missing-global.db"),
      ringBuffer: { readSince: () => [] },
      pressure: { current: () => null, history: () => [] },
      footprints: { list: () => [] },
      backup: { lastVerifiedAt: () => null },
      providers: { current: () => [] },
      conformance: { current: () => [] },
      storage: { current: () => null },
    }).aggregate(now);
    expect(snapshot.writeLatency.p99Ms).toBe(80);
    expect(snapshot.writeLatency.withinSlo).toBe(false);
  });

  it("keeps state.db intact when telemetry.db is corrupt or locked", () => {
    const directory = tempDir();
    const statePath = join(directory, "state.db");
    markerDb(statePath, 4, "do-not-touch");
    const before = readFileSync(statePath);
    const telemetryPath = join(directory, "telemetry.db");
    writeFileSync(telemetryPath, "not a database");
    const snapshot = new DiagnosticsMetricsAggregator({
      telemetryPath,
      stateDbPath: statePath,
      globalDbPath: join(directory, "global.db"),
      ringBuffer: { readSince: () => [] },
      pressure: { current: () => null, history: () => [] },
      footprints: { list: () => [] },
      backup: { lastVerifiedAt: () => null },
      providers: { current: () => [] },
      conformance: { current: () => [] },
      storage: { current: () => null },
    }).aggregate(Date.UTC(2026, 10, 22));
    expect(snapshot.telemetryAvailable).toBe(false);
    expect(snapshot.unavailableMessage).toBe(TELEMETRY_UNAVAILABLE_MESSAGE);
    expect(readFileSync(statePath)).toEqual(before);
    const locked = join(directory, "locked-dir");
    mkdirSync(locked);
    const lockedSnapshot = new DiagnosticsMetricsAggregator({
      telemetryPath: locked,
      stateDbPath: statePath,
      globalDbPath: join(directory, "global.db"),
      ringBuffer: { readSince: () => [] },
      pressure: { current: () => null, history: () => [] },
      footprints: { list: () => [] },
      backup: { lastVerifiedAt: () => null },
      providers: { current: () => [] },
      conformance: { current: () => [] },
      storage: { current: () => null },
    }).aggregate(Date.UTC(2026, 10, 22));
    expect(lockedSnapshot.unavailableMessage).toBe(TELEMETRY_UNAVAILABLE_MESSAGE);
    expect(readFileSync(statePath)).toEqual(before);
  });
});

describe("diagnostics telemetry retention", () => {
  it("prunes 1 Hz hardware samples older than 7 days and keeps 90 day daily aggregates", () => {
    const directory = tempDir();
    const telemetryPath = join(directory, "telemetry.db");
    const now = Date.UTC(2026, 10, 22, 12);
    const day = 24 * 60 * 60 * 1000;
    const old = sample(now - 8 * day, 100, "Orange", 1);
    const recent = sample(now - day, 200, "Green", 1);
    seed(telemetryPath, [
      { ts: old.at, kind: "hw_1hz", data: JSON.stringify(old) },
      { ts: recent.at, kind: "hw_1hz", data: JSON.stringify(recent) },
      { ts: now - 8 * day, kind: "sqlite_write", data: JSON.stringify({ latencyMs: 9, busyRetries: 4 }) },
      { ts: now - 100 * day, kind: "hw_daily", data: JSON.stringify({ samples: 1, pressureMode: "Green" }) },
      { ts: now - 10 * day, kind: "hw_daily", data: JSON.stringify({ samples: 2, pressureMode: "Yellow" }) },
    ]);
    const result = new TelemetryRetentionSweeper(telemetryPath, () => now).sweep();
    expect(result.prunedSamples).toBeGreaterThan(0);
    expect(result.bytes).toBeLessThan(TELEMETRY_SIZE_BUDGET_BYTES);
    const database = new DatabaseSync(telemetryPath, { readOnly: true });
    const kinds = database.prepare("SELECT kind, ts, data FROM telemetry ORDER BY ts").all();
    database.close();
    const hardware = kinds.filter((row) => row.kind === "hw_1hz");
    expect(hardware).toHaveLength(1);
    expect(hardware[0]?.ts).toBe(recent.at);
    const daily = kinds.filter((row) => row.kind === "hw_daily");
    expect(daily.some((row) => row.ts === now - 100 * day)).toBe(false);
    expect(daily.some((row) => row.ts === now - 10 * day)).toBe(true);
    expect(daily.some((row) => typeof row.data === "string" && row.data.includes("Orange"))).toBe(true);
    expect(kinds.some((row) => row.kind === "sqlite_daily" && typeof row.data === "string" && row.data.includes("\"p99Ms\":9"))).toBe(true);
  });

  it("keeps a 60 day installation under 50 MB after the 7 day pruner runs", () => {
    const directory = tempDir();
    const telemetryPath = join(directory, "telemetry.db");
    const now = Date.UTC(2026, 10, 22, 12);
    const day = 24 * 60 * 60 * 1000;
    rebuildTelemetryDatabase(telemetryPath);
    const database = new DatabaseSync(telemetryPath);
    const insert = database.prepare("INSERT INTO telemetry (attempt, ts, kind, data) VALUES (NULL, ?, ?, ?)");
    database.exec("BEGIN IMMEDIATE");
    for (let offset = 0; offset < 60; offset += 1) {
      insert.run(
        now - offset * day,
        "hw_daily",
        JSON.stringify({ samples: 86400, ramUsedAvg: 1000 + offset, pressureMode: "Green" }),
      );
    }
    const minute = JSON.stringify({
      stepMs: 1000,
      count: 60,
      ramUsedBytes: Array.from({ length: 60 }, (_, index) => 1500 + (index % 7)),
      ramTotalBytes: 16000,
      commitUsedBytes: 4000,
      commitLimitBytes: 32000,
      diskFreeProjectBytes: 80_000_000_000,
      diskFreeAppDataBytes: 20_000_000_000,
      avCpuPercent: 5,
      uiInputToPaintP95Ms: 11,
      pressure: "Green",
      pools: [[2, 12], [1, 4], [0, 2]],
    });
    const minutes = 8 * 24 * 60;
    for (let index = 1; index <= minutes; index += 1) {
      insert.run(now - index * 60 * 1000, "hw_minute", minute);
    }
    database.exec("COMMIT");
    database.close();
    const result = new TelemetryRetentionSweeper(telemetryPath, () => now).sweep();
    expect(result.bytes).toBeLessThan(TELEMETRY_SIZE_BUDGET_BYTES);
    const check = new DatabaseSync(telemetryPath, { readOnly: true });
    const kept = check.prepare("SELECT COUNT(*) AS count FROM telemetry WHERE kind = 'hw_minute'").get();
    const dailies = check.prepare("SELECT COUNT(*) AS count FROM telemetry WHERE kind = 'hw_daily'").get();
    check.close();
    expect(Number(kept?.count)).toBe(7 * 24 * 60);
    expect(Number(dailies?.count)).toBe(60);
  });
});
