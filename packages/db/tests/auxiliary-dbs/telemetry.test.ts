import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { canonicalAssetAbsolute } from "@ef-harness/shared-contracts";
import {
  InvalidTelemetryEventError,
  TELEMETRY_FLUSH_INTERVAL_MS,
  TELEMETRY_FLUSH_ROWS,
  TELEMETRY_QUEUE_CAP,
  TELEMETRY_RETENTION_MS,
  TelemetryDb,
  loadCanonicalSchema,
  schemaTableNames,
} from "../../src/auxiliary-dbs/index.js";
import { useTempDirs } from "./lifecycle.js";

describe("telemetry database", () => {
  const dirs = useTempDirs();

  function open(
    name: string,
    options: { readonly now?: () => number; readonly queueCap?: number; readonly flushIntervalMs?: number } = {},
  ): { db: TelemetryDb; filePath: string } {
    const root = dirs.root(name);
    const filePath = path.join(root, "telemetry.db");
    const db = TelemetryDb.open({
      filePath,
      now: options.now ?? (() => 1_700_000_000_000),
      flushIntervalMs: options.flushIntervalMs ?? 60_000,
      ...(options.queueCap === undefined ? {} : { queueCap: options.queueCap }),
    });
    dirs.close(() => db.close());
    return { db, filePath };
  }

  it("bootstraps telemetry.db from the canonical schema with WAL and NORMAL synchronous", () => {
    const canonical = fs.readFileSync(canonicalAssetAbsolute("telemetrySql"), "utf8");
    expect(loadCanonicalSchema("telemetry")).toBe(canonical);
    const { db } = open("telemetry-bootstrap");
    expect(db.schemaTables()).toEqual([...schemaTableNames(canonical)].sort());
    expect(db.connectionSettings()).toEqual({ journalMode: "wal", synchronous: "normal" });
    expect(db.attachedDatabaseNames()).toEqual(["main"]);
    db.verifyIsolatedConnection();
    expect(TELEMETRY_FLUSH_INTERVAL_MS).toBe(250);
    expect(TELEMETRY_FLUSH_ROWS).toBe(200);
    expect(TELEMETRY_QUEUE_CAP).toBe(2_000);
    expect(TELEMETRY_RETENTION_MS).toBe(14 * 24 * 60 * 60 * 1000);
  });

  it("flushes 200-row batches in one transaction and the default 250ms interval", async () => {
    const now = 1_700_000_000_000;
    const { db } = open("telemetry-batch", { now: () => now });
    for (let index = 0; index < 450; index += 1) {
      db.enqueue({ ts: now, kind: "tokens", data: { index }, attempt: "attempt-1" });
    }
    expect(db.count()).toBe(0);
    expect(db.stats().queued).toBe(450);
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
    expect(db.stats().flushTransactions).toBe(3);
    expect(db.stats().flushed).toBe(450);
    expect(db.count()).toBe(450);
    expect(db.readPage({ limit: 1 })[0]).toMatchObject({
      attempt: "attempt-1",
      kind: "tokens",
      data: { index: 0 },
    });

    vi.useFakeTimers();
    try {
      const timedRoot = dirs.root("telemetry-timer");
      const timed = TelemetryDb.open({
        filePath: path.join(timedRoot, "telemetry.db"),
        now: () => now,
      });
      dirs.close(() => timed.close());
      timed.enqueue({ ts: now, kind: "metric", data: { beat: 1 } });
      expect(timed.count()).toBe(0);
      await vi.advanceTimersByTimeAsync(TELEMETRY_FLUSH_INTERVAL_MS);
      expect(timed.count()).toBe(1);
      expect(timed.stats().flushTransactions).toBe(1);
      timed.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops excess progress frames from a 10000-event burst and keeps the newest 2000", async () => {
    const now = 1_700_000_000_000;
    const { db } = open("telemetry-burst", { now: () => now });
    let dropped = 0;
    for (let index = 0; index < 10_000; index += 1) {
      dropped += db.enqueue({ ts: now, kind: "progress", data: { index } }).dropped;
    }
    expect(dropped).toBe(8_000);
    expect(db.stats()).toMatchObject({ queued: 2_000, dropped: 8_000, flushed: 0 });
    expect(db.count()).toBe(0);
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
    expect(db.count()).toBe(2_000);
    expect(db.stats().flushTransactions).toBe(10);
    const rows = readAll(db);
    expect(rows).toHaveLength(2_000);
    expect(rows[0]?.data).toEqual({ index: 8_000 });
    expect(rows[1_999]?.data).toEqual({ index: 9_999 });
  });

  it("sheds oldest progress and heartbeat rows before dropping tokens", () => {
    const now = 1_700_000_000_000;
    const { db } = open("telemetry-shed", { now: () => now, queueCap: 4 });
    db.enqueue({ ts: now, kind: "progress", data: { index: 1 } });
    db.enqueue({ ts: now, kind: "progress", data: { index: 2 } });
    db.enqueue({ ts: now, kind: "progress", data: { index: 3 } });
    db.enqueue({ ts: now, kind: "heartbeat", data: { index: 4 } });
    const token = db.enqueue({ ts: now, kind: "tokens", data: { index: 5 } });
    expect(token).toEqual({ accepted: true, dropped: 1 });
    db.flush();
    expect(readAll(db).map((row) => row.data)).toEqual([
      { index: 2 },
      { index: 3 },
      { index: 4 },
      { index: 5 },
    ]);

    const full = open("telemetry-tokens", { now: () => now, queueCap: 2 });
    full.db.enqueue({ ts: now, kind: "tokens", data: { name: "a" } });
    full.db.enqueue({ ts: now, kind: "tokens", data: { name: "b" } });
    expect(full.db.enqueue({ ts: now, kind: "progress", data: { name: "noise" } })).toEqual({
      accepted: false,
      dropped: 1,
    });
    full.db.flush();
    expect(readAll(full.db).map((row) => row.kind)).toEqual(["tokens", "tokens"]);
    expect(() => full.db.enqueue({ ts: now, kind: "noise" as "metric", data: {} })).toThrow(
      InvalidTelemetryEventError,
    );
  });

  it("prunes telemetry rows older than 14 days and keeps the boundary row", () => {
    let now = 20_000_000_000_000;
    const { db, filePath } = open("telemetry-retention", { now: () => now });
    const cutoff = now - TELEMETRY_RETENTION_MS;
    db.enqueue({ ts: cutoff - 1, kind: "progress", data: { age: "older" } });
    db.enqueue({ ts: cutoff, kind: "tokens", data: { age: "boundary" } });
    db.enqueue({ ts: cutoff + 1, kind: "heartbeat", data: { age: "newer" } });
    db.enqueue({ ts: now, kind: "tool", data: { age: "now" } });
    expect(db.flush()).toBe(4);
    expect(readAll(db).map((row) => row.data)).toEqual([
      { age: "boundary" },
      { age: "newer" },
      { age: "now" },
    ]);
    expect(db.pruneRetention(now)).toBe(0);
    db.close();

    now += TELEMETRY_RETENTION_MS + 1;
    const reopened = TelemetryDb.open({
      filePath,
      now: () => now,
      flushIntervalMs: 60_000,
    });
    dirs.close(() => reopened.close());
    expect(reopened.count()).toBe(0);
    expect(reopened.schemaTables()).toEqual(["telemetry"]);
  });
});

function readAll(db: TelemetryDb) {
  const rows = [];
  let afterId = 0;
  for (;;) {
    const page = db.readPage({ afterId, limit: 500 });
    if (page.length === 0) break;
    rows.push(...page);
    const last = page[page.length - 1];
    if (last === undefined) break;
    afterId = last.id;
  }
  return rows;
}
