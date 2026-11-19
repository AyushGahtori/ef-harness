import { readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { OutboxConnection, OutboxStatement } from "../../src/outbox/connection.js";
import {
  DEFAULT_EVENT_CONSUMERS,
  DEFAULT_OUTBOX_RETENTION_MS,
  EmptyOutboxConsumersError,
  InvalidOutboxEventError,
  OutboxRepo,
  OutboxTransactionRequiredError,
  PENDING_FOR_CONSUMER_SQL,
  TelemetryNotAllowedInOutboxError,
  canonicalOutboxQueries,
  deliveryBackoffMs,
  parseNamedQueries,
  readStateSchemaSql,
  repositoryRoot,
  resolveEventConsumers,
  retainedHistoryRequiresResync,
  streamEpochRequiresResync,
} from "../../src/outbox/index.js";

function splitSearchText(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return "";
  const extra = value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_\-./:]+/g, " ");
  return `${value} ${extra}`;
}

function openStateDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.function("ef_search_text", { deterministic: true }, (value) => splitSearchText(value));
  db.exec(readStateSchemaSql());
  return db;
}

function withImmediate<T>(db: DatabaseSync, run: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = run();
    db.exec("COMMIT");
    return value;
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
}

function count(db: DatabaseSync, sql: string): number {
  const row = db.prepare(sql).get() as { c: number } | undefined;
  return row?.c ?? 0;
}

function recordingConnection(db: DatabaseSync): { conn: OutboxConnection; calls: string[] } {
  const calls: string[] = [];
  const conn: OutboxConnection = {
    get isTransaction() {
      return db.isTransaction;
    },
    exec(sql: string) {
      calls.push(sql);
      db.exec(sql);
    },
    prepare(sql: string): OutboxStatement {
      calls.push(sql);
      const statement = db.prepare(sql);
      return {
        run(params) {
          const result = params ? statement.run(params) : statement.run();
          return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
        },
        get(params) {
          const row = params ? statement.get(params) : statement.get();
          return row as Record<string, null | number | bigint | string> | undefined;
        },
        all(params) {
          const rows = params ? statement.all(params) : statement.all();
          return rows as Array<Record<string, null | number | bigint | string>>;
        },
      };
    },
  };
  return { conn, calls };
}

describe("transactional outbox", () => {
  let db: DatabaseSync | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  it("loads register_delivery, prune_outbox, and outbox_without_deliveries verbatim", () => {
    const file = readFileSync(path.join(repositoryRoot(), "schema", "queries.sql"), "utf8");
    const independent = parseNamedQueries(file);
    const canonical = canonicalOutboxQueries();
    expect(canonical.register_delivery).toBe(independent.register_delivery);
    expect(canonical.prune_outbox).toBe(independent.prune_outbox);
    expect(canonical.outbox_without_deliveries).toBe(independent.outbox_without_deliveries);
    expect(canonical.register_delivery).toBe(
      "INSERT INTO outbox_deliveries(event_id, consumer) VALUES (:event_id, :consumer)",
    );
    expect(canonical.prune_outbox).toBe(
      "DELETE FROM outbox\n WHERE created_at < :cutoff\n   AND EXISTS (SELECT 1 FROM outbox_deliveries d WHERE d.event_id = outbox.id)\n   AND NOT EXISTS (SELECT 1 FROM outbox_deliveries d WHERE d.event_id = outbox.id AND d.delivered_at IS NULL)",
    );
    expect(canonical.outbox_without_deliveries).toBe(
      "SELECT o.id FROM outbox o WHERE NOT EXISTS (SELECT 1 FROM outbox_deliveries d WHERE d.event_id = o.id)",
    );
    expect(DEFAULT_OUTBOX_RETENTION_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("rejects an empty consumer list before any SQL", () => {
    db = openStateDb();
    const { conn, calls } = recordingConnection(db);
    const repo = new OutboxRepo();
    db.exec("BEGIN IMMEDIATE");
    expect(() =>
      repo.appendEventInTx(conn, { id: "EV-empty", type: "TaskAccepted", payload: {} }, []),
    ).toThrow(EmptyOutboxConsumersError);
    expect(calls).toEqual([]);
    expect(count(db, "SELECT count(*) AS c FROM outbox")).toBe(0);
    expect(db.isTransaction).toBe(true);
    db.exec("ROLLBACK");
  });

  it("rejects telemetry, heartbeats, and token deltas before insert", () => {
    db = openStateDb();
    const repo = new OutboxRepo();
    db.exec("BEGIN IMMEDIATE");
    expect(() =>
      repo.appendEventInTx(db, { id: "EV-t", type: "telemetry.progress", payload: {} }, ["scheduler"]),
    ).toThrow(TelemetryNotAllowedInOutboxError);
    expect(() =>
      repo.appendEventInTx(db, { id: "EV-h", type: "worker.heartbeat", payload: {} }, ["scheduler"]),
    ).toThrow(TelemetryNotAllowedInOutboxError);
    expect(() =>
      repo.appendEventInTx(db, { id: "EV-d", type: "token.delta", payload: {} }, ["scheduler"]),
    ).toThrow(TelemetryNotAllowedInOutboxError);
    expect(count(db, "SELECT count(*) AS c FROM outbox")).toBe(0);
    db.exec("ROLLBACK");
  });

  it("requires the caller's BEGIN IMMEDIATE transaction", () => {
    db = openStateDb();
    const repo = new OutboxRepo();
    expect(() =>
      repo.appendEventInTx(db, { id: "EV-tx", type: "SeqProbe", payload: {} }, ["scheduler"]),
    ).toThrow(OutboxTransactionRequiredError);
    expect(count(db, "SELECT count(*) AS c FROM outbox")).toBe(0);
  });

  it("appends the event and a delivery row for every consumer in one transaction", () => {
    db = openStateDb();
    const { conn, calls } = recordingConnection(db);
    const repo = new OutboxRepo();
    const created = Date.parse("2026-11-16T13:05:00Z");
    db.exec("BEGIN IMMEDIATE");
    db.prepare("INSERT INTO meta(key, value) VALUES ('last_rev', '214')").run();
    const event = repo.appendEventInTx(
      conn,
      {
        id: "EV-55120",
        type: "FeatureCompleted",
        revision: 214,
        subject: "F12",
        created: "2026-11-16T13:05:00Z",
        payload: { feature: "F12" },
      },
      ["scheduler"],
    );
    expect(event.seq).toBe(1);
    expect(event.rev).toBe(214);
    expect(event.subject).toBe("F12");
    expect(event.createdAt).toBe(created);
    expect(event.payload).toEqual({ feature: "F12" });
    expect(event.consumers).toEqual(["scheduler", "exporter", "broker", "ui_projection"]);
    expect(count(db, "SELECT count(*) AS c FROM outbox_deliveries")).toBe(4);
    db.exec("ROLLBACK");
    expect(count(db, "SELECT count(*) AS c FROM outbox")).toBe(0);
    expect(count(db, "SELECT count(*) AS c FROM outbox_deliveries")).toBe(0);
    expect(count(db, "SELECT count(*) AS c FROM meta WHERE key = 'last_rev'")).toBe(0);
    expect(calls).toContain(canonicalOutboxQueries().register_delivery);
  });

  it("commits ContractChanged and DependencyReady as two rows for every subscribed consumer", () => {
    db = openStateDb();
    const repo = new OutboxRepo();
    const consumers = ["scheduler", "exporter", "ui_projection"] as const;
    withImmediate(db, () => {
      db.prepare("INSERT INTO meta(key, value) VALUES ('last_rev', '40')").run();
      const changed = repo.appendEventInTx(
        db,
        { id: "EV-CC", type: "ContractChanged", rev: 40, subject: "C-014", payload: { contract: "C-014" } },
        consumers,
      );
      const ready = repo.appendEventInTx(
        db,
        { id: "EV-DR", type: "DependencyReady", rev: 40, subject: "T07", payload: { task: "T07" } },
        consumers,
      );
      expect(changed.seq).toBe(1);
      expect(ready.seq).toBe(2);
      expect(changed.consumers).toEqual([...consumers]);
      expect(ready.consumers).toEqual([...consumers]);
    });
    expect(count(db, "SELECT count(*) AS c FROM outbox")).toBe(2);
    expect(count(db, "SELECT count(*) AS c FROM outbox_deliveries")).toBe(6);
    const ids = db.prepare("SELECT id FROM outbox ORDER BY seq").all() as Array<{ id: string }>;
    expect(ids.map((row) => row.id)).toEqual(["EV-CC", "EV-DR"]);
  });

  it("fills exporter and ui_projection for every routed event type", () => {
    for (const consumers of Object.values(DEFAULT_EVENT_CONSUMERS)) {
      expect(consumers).toContain("exporter");
      expect(consumers).toContain("ui_projection");
    }
    expect(resolveEventConsumers("TaskAccepted", ["scheduler"])).toEqual([
      "scheduler",
      "exporter",
      "ui_projection",
    ]);
    expect(resolveEventConsumers("SeqProbe", ["scheduler"])).toEqual(["scheduler"]);
    expect(resolveEventConsumers("FeatureCompleted", ["ui_projection", "scheduler"])).toEqual([
      "ui_projection",
      "scheduler",
      "exporter",
      "broker",
    ]);
  });

  it("reproduces schema-test pruning, R1, and never-reused seq", () => {
    db = openStateDb();
    const repo = new OutboxRepo();
    db.exec(
      "INSERT INTO outbox(id, type, payload, created_at) VALUES ('EV-1','TaskAccepted','{}',0),('EV-2','FeatureCompleted','{}',0)",
    );
    db.exec("INSERT INTO outbox_deliveries VALUES ('EV-1','scheduler',5),('EV-2','scheduler',NULL)");
    repo.pruneAcknowledgedOutbox(db, 10);
    const left = (db.prepare("SELECT id FROM outbox").all() as Array<{ id: string }>).map((row) => row.id);
    expect(left).toEqual(["EV-2"]);
    db.exec("DELETE FROM outbox WHERE id='EV-2'");
    db.exec("INSERT INTO outbox(id, type, payload, created_at) VALUES ('EV-3','X','{}',0)");
    const seq = (db.prepare("SELECT seq FROM outbox WHERE id='EV-3'").get() as { seq: number }).seq;
    expect(seq).toBe(3);

    db.exec("INSERT INTO outbox(id, type, payload, created_at) VALUES ('EV-4','TaskAccepted','{}',0)");
    const before = count(db, "SELECT count(*) AS c FROM outbox WHERE id='EV-4'");
    repo.pruneAcknowledgedOutbox(db, 10);
    expect(count(db, "SELECT count(*) AS c FROM outbox WHERE id='EV-4'")).toBe(before);
    const audit = repo.auditOutboxDeliveries(db);
    expect(audit.eventIds).toContain("EV-4");
    expect(audit.alerted).toBe(true);
    expect(repo.readAlerts()[0]?.severity).toBe("high");
    expect(count(db, "SELECT count(*) AS c FROM outbox WHERE id='EV-4'")).toBe(1);
  });

  it("prunes the highest seq and assigns the next event old_max + 1", () => {
    db = openStateDb();
    const repo = new OutboxRepo({ now: () => 10 });
    withImmediate(db, () => {
      repo.appendEventInTx(db, { id: "EV-1", type: "SeqProbe", payload: {}, createdAt: 0 }, ["scheduler"]);
      repo.appendEventInTx(db, { id: "EV-2", type: "SeqProbe", payload: {}, createdAt: 0 }, ["scheduler"]);
      repo.acknowledgeDelivery(db, "EV-1", "scheduler", 5);
      repo.acknowledgeDelivery(db, "EV-2", "scheduler", 5);
    });
    expect(repo.pruneAcknowledgedOutbox(db, 10).deleted).toBe(2);
    expect(count(db, "SELECT count(*) AS c FROM outbox")).toBe(0);
    const third = withImmediate(db, () =>
      repo.appendEventInTx(db, { id: "EV-3", type: "SeqProbe", payload: {}, createdAt: 0 }, ["scheduler"]),
    );
    expect(third.seq).toBe(3);
    const highWater = (db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'outbox'").get() as { seq: number })
      .seq;
    expect(highWater).toBe(3);
    const caughtUp = repo.replayEventsSince(db, 2);
    expect(caughtUp.resyncRequired).toBe(false);
    expect(caughtUp.events.map((event) => event.seq)).toEqual([3]);
    const stale = repo.replayEventsSince(db, 0);
    expect(stale.resyncRequired).toBe(true);
    expect(stale.events).toEqual([]);
  });

  it("keeps a slow consumer's events while healthy consumers advance, and emits lag", () => {
    db = openStateDb();
    const eightDays = 8 * 24 * 60 * 60 * 1000;
    const repo = new OutboxRepo({ now: () => eightDays, lagPendingThreshold: 100 });
    withImmediate(db, () => {
      repo.appendEventInTx(db, { id: "EV-slow", type: "SeqProbe", payload: {}, createdAt: 0 }, [
        "scheduler",
        "exporter",
      ]);
      repo.acknowledgeDelivery(db, "EV-slow", "scheduler", 5);
    });
    expect(repo.fetchPendingForConsumer(db, "scheduler")).toEqual([]);
    expect(repo.fetchPendingForConsumer(db, "exporter").map((row) => row.deliveryKey)).toEqual([
      "EV-slow:exporter",
    ]);
    const pruned = repo.pruneAcknowledgedOutbox(db);
    expect(pruned.deleted).toBe(0);
    expect(pruned.cutoff).toBe(eightDays - DEFAULT_OUTBOX_RETENTION_MS);
    expect(pruned.lags.find((lag) => lag.consumer === "exporter")?.lagging).toBe(true);
    expect(repo.readLagMetrics().some((metric) => metric.consumer === "exporter")).toBe(true);
    expect(count(db, "SELECT count(*) AS c FROM outbox WHERE id = 'EV-slow'")).toBe(1);
  });

  it("replays a fresh stream from seq 1 and signals resync when history was pruned", () => {
    db = openStateDb();
    const repo = new OutboxRepo();
    db.exec("INSERT INTO meta(key, value) VALUES ('stream_epoch', '7')");
    const fresh = repo.replayEventsSince(db, 0);
    expect(fresh.resyncRequired).toBe(false);
    expect(fresh.events).toEqual([]);
    expect(fresh.streamEpoch).toBe("7");
    expect(fresh.minRetainedSeq).toBeNull();

    withImmediate(db, () => {
      repo.appendEventInTx(db, { id: "EV-1", type: "SeqProbe", payload: { n: 1 }, createdAt: 1 }, [
        "scheduler",
      ]);
    });
    const fromStart = repo.replayEventsSince(db, 0);
    expect(fromStart.resyncRequired).toBe(false);
    expect(fromStart.minRetainedSeq).toBe(1);
    expect(fromStart.events.map((event) => event.seq)).toEqual([1]);
    expect(fromStart.events[0]?.payload).toEqual({ n: 1 });
    expect(retainedHistoryRequiresResync({ sinceSeq: 0, minRetainedSeq: 1, highWaterSeq: 1 })).toBe(
      false,
    );

    db.exec("INSERT INTO outbox(seq, id, type, payload, created_at) VALUES (500, 'EV-500', 'SeqProbe', '{}', 2)");
    const behind = repo.replayEventsSince(db, 0);
    expect(behind.minRetainedSeq).toBe(1);
    db.exec("DELETE FROM outbox WHERE seq < 500");
    const prunedWindow = repo.replayEventsSince(db, 0);
    expect(prunedWindow.minRetainedSeq).toBe(500);
    expect(prunedWindow.resyncRequired).toBe(true);
    expect(prunedWindow.events).toEqual([]);
    const contiguous = repo.replayEventsSince(db, 499);
    expect(contiguous.resyncRequired).toBe(false);
    expect(contiguous.events.map((event) => event.seq)).toEqual([500]);
    const gapped = repo.replayEventsSince(db, 400);
    expect(gapped.resyncRequired).toBe(true);
    expect(streamEpochRequiresResync("9", "7")).toBe(true);
    expect(streamEpochRequiresResync("7", "7")).toBe(false);
    expect(streamEpochRequiresResync(null, "7")).toBe(false);
  });

  it("returns gap-free batches, honors topics and limit, and resyncs on an internal hole", () => {
    db = openStateDb();
    const repo = new OutboxRepo();
    withImmediate(db, () => {
      repo.appendEventInTx(db, { id: "EV-A", type: "ContractChanged", payload: {}, createdAt: 1 }, [
        "scheduler",
      ]);
      repo.appendEventInTx(db, { id: "EV-B", type: "DependencyReady", payload: {}, createdAt: 2 }, [
        "scheduler",
      ]);
      repo.appendEventInTx(db, { id: "EV-C", type: "ContractChanged", payload: {}, createdAt: 3 }, [
        "scheduler",
      ]);
    });
    const page = repo.replayEventsSince(db, 0, undefined, 2);
    expect(page.events.map((event) => event.seq)).toEqual([1, 2]);
    expect(page.hasMore).toBe(true);
    expect(page.fromSeq).toBe(1);
    expect(page.toSeq).toBe(2);
    const rest = repo.replayEventsSince(db, 2);
    expect(rest.events.map((event) => event.id)).toEqual(["EV-C"]);
    expect(rest.hasMore).toBe(false);
    const onlyContracts = repo.replayEventsSince(db, 0, ["ContractChanged"]);
    expect(onlyContracts.events.map((event) => event.id)).toEqual(["EV-A", "EV-C"]);
    expect(onlyContracts.events.map((event) => event.seq)).toEqual([1, 3]);

    db.exec("DELETE FROM outbox WHERE seq = 2");
    const prefix = repo.replayEventsSince(db, 0);
    expect(prefix.resyncRequired).toBe(false);
    expect(prefix.events.map((event) => event.seq)).toEqual([1]);
    expect(prefix.hasMore).toBe(true);
    const hole = repo.replayEventsSince(db, 1);
    expect(hole.resyncRequired).toBe(true);
    expect(hole.events).toEqual([]);
  });

  it("polls pending deliveries through the outbox_pending index in seq order", () => {
    db = openStateDb();
    const repo = new OutboxRepo();
    withImmediate(db, () => {
      repo.appendEventInTx(db, { id: "EV-1", type: "SeqProbe", payload: {}, createdAt: 1 }, ["scheduler"]);
      repo.appendEventInTx(db, { id: "EV-2", type: "SeqProbe", payload: {}, createdAt: 2 }, ["scheduler"]);
    });
    const pending = repo.fetchPendingForConsumer(db, "scheduler");
    expect(pending.map((row) => row.seq)).toEqual([1, 2]);
    expect(pending.map((row) => row.deliveryKey)).toEqual(["EV-1:scheduler", "EV-2:scheduler"]);
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${PENDING_FOR_CONSUMER_SQL}`).all({
      consumer: "scheduler",
      limit: 10,
    }) as Array<{ detail?: string }>;
    const details = plan.map((row) => row.detail ?? "").join("\n");
    expect(details).toContain("outbox_pending");
  });

  it("rejects a non-integer replay cursor", () => {
    db = openStateDb();
    const repo = new OutboxRepo();
    expect(() => repo.replayEventsSince(db, -1)).toThrow(InvalidOutboxEventError);
    expect(deliveryBackoffMs(1, 10, 1_000)).toBe(10);
    expect(deliveryBackoffMs(2, 10, 1_000)).toBe(20);
    expect(deliveryBackoffMs(3, 10, 25)).toBe(25);
    expect(
      retainedHistoryRequiresResync({ sinceSeq: 0, minRetainedSeq: 500, highWaterSeq: 500 }),
    ).toBe(true);
    expect(
      retainedHistoryRequiresResync({ sinceSeq: 499, minRetainedSeq: 500, highWaterSeq: 500 }),
    ).toBe(false);
  });
});
