import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  OutboxDispatcher,
  OutboxRepo,
  OutboxStartupReplayPendingError,
  PermanentOutboxDeliveryError,
  readStateSchemaSql,
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

describe("outbox dispatcher", () => {
  let db: DatabaseSync | undefined;
  const dispatchers: OutboxDispatcher[] = [];

  afterEach(() => {
    for (const dispatcher of dispatchers) dispatcher.stop();
    dispatchers.length = 0;
    db?.close();
    db = undefined;
  });

  it("retries a thrown handler once, acks, and does not deliver a third time", async () => {
    db = openStateDb();
    const repo = new OutboxRepo({ now: () => 50 });
    withImmediate(db, () => {
      repo.appendEventInTx(db!, { id: "EV-1", type: "SeqProbe", payload: { ok: true }, createdAt: 1 }, [
        "scheduler",
      ]);
    });
    const delays: number[] = [];
    let calls = 0;
    const dispatcher = new OutboxDispatcher(repo, db, {
      maxAttempts: 3,
      baseDelayMs: 10,
      maxDelayMs: 1_000,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    dispatchers.push(dispatcher);
    const seen: number[] = [];
    dispatcher.registerConsumer("scheduler", (event, seq, key) => {
      calls += 1;
      expect(key).toBe("EV-1:scheduler");
      expect(seq).toBe(event.seq);
      if (calls === 1) throw new Error("transient failure");
      seen.push(seq);
    });
    expect(() => dispatcher.assertNewTurnsAllowed()).toThrow(OutboxStartupReplayPendingError);
    const first = await dispatcher.dispatchPending("scheduler");
    expect(first.delivered).toBe(1);
    expect(first.blockedConsumers).toEqual([]);
    expect(calls).toBe(2);
    expect(delays).toEqual([10]);
    expect(seen).toEqual([1]);
    const row = db.prepare(
      "SELECT delivered_at AS delivered_at FROM outbox_deliveries WHERE event_id = 'EV-1'",
    ).get() as { delivered_at: number };
    expect(row.delivered_at).toBe(50);
    await dispatcher.dispatchPending("scheduler");
    expect(calls).toBe(2);
  });

  it("redelivers after a crash before delivered_at and the consumer dedupes on the receipt", async () => {
    db = openStateDb();
    db.exec(
      "CREATE TABLE app_receipts (event_id TEXT NOT NULL, consumer TEXT NOT NULL, applied INTEGER NOT NULL, PRIMARY KEY (event_id, consumer))",
    );
    const repo = new OutboxRepo({ now: () => 80 });
    withImmediate(db, () => {
      repo.appendEventInTx(db!, { id: "EV-crash", type: "SeqProbe", payload: {}, createdAt: 1 }, [
        "scheduler",
      ]);
    });
    let applied = 0;
    const handler = () => {
      const existing = db!
        .prepare("SELECT applied FROM app_receipts WHERE event_id = ? AND consumer = ?")
        .get("EV-crash", "scheduler") as { applied: number } | undefined;
      if (existing) return;
      db!.exec("BEGIN IMMEDIATE");
      db!.prepare("INSERT INTO app_receipts(event_id, consumer, applied) VALUES (?, ?, 1)").run(
        "EV-crash",
        "scheduler",
      );
      applied += 1;
      db!.exec("COMMIT");
      throw new Error("crash before delivered_at");
    };
    const crashed = new OutboxDispatcher(repo, db, { maxAttempts: 1, sleep: async () => undefined });
    dispatchers.push(crashed);
    crashed.registerConsumer("scheduler", handler);
    const blocked = await crashed.replayPendingOnStartup();
    expect(blocked.delivered).toBe(0);
    expect(blocked.blockedConsumers).toEqual(["scheduler"]);
    expect(applied).toBe(1);
    crashed.assertNewTurnsAllowed();
    const pending = db
      .prepare("SELECT delivered_at FROM outbox_deliveries WHERE event_id = 'EV-crash'")
      .get() as { delivered_at: number | null };
    expect(pending.delivered_at).toBeNull();

    const restarted = new OutboxDispatcher(repo, db, { maxAttempts: 2, sleep: async () => undefined });
    dispatchers.push(restarted);
    let restartedCalls = 0;
    restarted.registerConsumer("scheduler", () => {
      restartedCalls += 1;
      const existing = db!
        .prepare("SELECT applied FROM app_receipts WHERE event_id = ? AND consumer = ?")
        .get("EV-crash", "scheduler") as { applied: number } | undefined;
      if (existing) return;
      applied += 1;
    });
    const second = await restarted.dispatchPending("scheduler");
    expect(second.delivered).toBe(1);
    expect(applied).toBe(1);
    expect(restartedCalls).toBe(1);
    const acked = db
      .prepare("SELECT delivered_at FROM outbox_deliveries WHERE event_id = 'EV-crash'")
      .get() as { delivered_at: number };
    expect(acked.delivered_at).toBe(80);
    await restarted.dispatchPending("scheduler");
    expect(restartedCalls).toBe(1);
  });

  it("delivers two revision events independently and does not block a healthy consumer", async () => {
    db = openStateDb();
    const repo = new OutboxRepo({ now: () => 9 });
    withImmediate(db, () => {
      repo.appendEventInTx(
        db!,
        { id: "EV-CC", type: "ContractChanged", rev: 3, payload: { kind: "contract" }, createdAt: 1 },
        ["scheduler", "exporter"],
      );
      repo.appendEventInTx(
        db!,
        { id: "EV-DR", type: "DependencyReady", rev: 3, payload: { kind: "ready" }, createdAt: 2 },
        ["scheduler", "exporter"],
      );
    });
    const dispatcher = new OutboxDispatcher(repo, db, {
      maxAttempts: 2,
      baseDelayMs: 1,
      sleep: async () => undefined,
    });
    dispatchers.push(dispatcher);
    const scheduler: string[] = [];
    const projection: string[] = [];
    const exporter: string[] = [];
    dispatcher.registerConsumer("scheduler", (event) => {
      scheduler.push(event.id);
    });
    dispatcher.registerConsumer("ui_projection", (event) => {
      projection.push(event.id);
    });
    dispatcher.registerConsumer("exporter", () => {
      exporter.push("called");
      throw new PermanentOutboxDeliveryError("exporter paused");
    });
    const result = await dispatcher.replayPendingOnStartup();
    expect(scheduler).toEqual(["EV-CC", "EV-DR"]);
    expect(projection).toEqual(["EV-CC", "EV-DR"]);
    expect(exporter).toEqual(["called"]);
    expect(result.delivered).toBe(4);
    expect(result.blockedConsumers).toEqual(["exporter"]);
    const schedulerLeft = countPending(db, "scheduler");
    const exporterLeft = countPending(db, "exporter");
    expect(schedulerLeft).toBe(0);
    expect(exporterLeft).toBe(2);
    dispatcher.assertNewTurnsAllowed();
  });

  it("audits delivery-less rows at startup without pruning them", async () => {
    db = openStateDb();
    const repo = new OutboxRepo({ now: () => 10_000 });
    db.exec("INSERT INTO outbox(id, type, payload, created_at) VALUES ('EV-4','TaskAccepted','{}',0)");
    const dispatcher = new OutboxDispatcher(repo, db, {
      maintenanceIntervalMs: 60_000,
      sleep: async () => undefined,
    });
    dispatchers.push(dispatcher);
    const startup = await dispatcher.start();
    expect(startup.audit.eventIds).toContain("EV-4");
    expect(countRows(db, "SELECT count(*) AS c FROM outbox WHERE id = 'EV-4'")).toBe(1);
    const maintenance = dispatcher.runMaintenance();
    expect(maintenance.deleted).toBe(0);
    expect(maintenance.auditIds).toContain("EV-4");
    expect(countRows(db, "SELECT count(*) AS c FROM outbox WHERE id = 'EV-4'")).toBe(1);
    dispatcher.stop();
  });

  it("acks inside the consumer transaction when the handler marks delivered_at", async () => {
    db = openStateDb();
    const repo = new OutboxRepo({ now: () => 4 });
    withImmediate(db, () => {
      repo.appendEventInTx(db!, { id: "EV-ack", type: "SeqProbe", payload: {}, createdAt: 1 }, [
        "scheduler",
      ]);
    });
    const dispatcher = new OutboxDispatcher(repo, db, { sleep: async () => undefined });
    dispatchers.push(dispatcher);
    dispatcher.registerConsumer("scheduler", (event, seq, key) => {
      expect(key).toBe(`${event.id}:scheduler`);
      expect(seq).toBe(event.seq);
      db!.exec("BEGIN IMMEDIATE");
      repo.acknowledgeDelivery(db!, event.id, "scheduler", 4);
      db!.exec("COMMIT");
    });
    await dispatcher.dispatchPending("scheduler");
    const row = db
      .prepare("SELECT delivered_at AS delivered_at FROM outbox_deliveries WHERE event_id = 'EV-ack'")
      .get() as { delivered_at: number };
    expect(row.delivered_at).toBe(4);
  });
});

function countPending(db: DatabaseSync, consumer: string): number {
  const row = db
    .prepare(
      "SELECT count(*) AS c FROM outbox_deliveries WHERE consumer = ? AND delivered_at IS NULL",
    )
    .get(consumer) as { c: number };
  return row.c;
}

function countRows(db: DatabaseSync, sql: string): number {
  const row = db.prepare(sql).get() as { c: number };
  return row.c;
}
