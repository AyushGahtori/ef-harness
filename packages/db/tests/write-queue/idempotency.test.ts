import { computeRequestHash } from "@ef-harness/shared-contracts";
import { afterEach, describe, expect, it } from "vitest";

import {
  CoordinatorWriteQueue,
  MissingOpIdError,
  OPERATIONS_RETENTION_MS,
  OpIdReusedError,
  canonicalQuery,
  defaultComputeRequestHash,
} from "../../src/write-queue/index.js";
import { openState, scalar, type OpenedState } from "./state-db.js";

const openDatabases: OpenedState[] = [];
const queues: CoordinatorWriteQueue[] = [];

afterEach(async () => {
  for (const queue of queues.splice(0)) await queue.drainAndClose();
  for (const opened of openDatabases.splice(0)) opened.close();
});

function startQueue(
  opened: OpenedState,
  options?: ConstructorParameters<typeof CoordinatorWriteQueue>[0],
): CoordinatorWriteQueue {
  openDatabases.push(opened);
  const queue = new CoordinatorWriteQueue({
    stateDb: opened.stateDb,
    coalesceWindowMs: 0,
    pruneIntervalMs: Number.POSITIVE_INFINITY,
    ...options,
    stateDb: opened.stateDb,
  });
  queues.push(queue);
  return queue;
}

describe("write-queue idempotency", () => {
  it("loads op_lookup and prune_operations from schema/queries.sql", () => {
    expect(canonicalQuery("op_lookup")).toContain("request_hash = :request_hash AS same_request");
    expect(canonicalQuery("op_lookup")).toContain("FROM operations WHERE op_id = :op_id");
    expect(canonicalQuery("prune_operations")).toBe(
      "DELETE FROM operations WHERE created_at < :cutoff;",
    );
  });

  it("hashes canonical requests independent of key order and NFC", () => {
    const composed = "e\u0301";
    const precomposed = "\u00e9";
    expect(defaultComputeRequestHash({ b: 1, a: composed })).toBe(
      defaultComputeRequestHash({ a: precomposed, b: 1 }),
    );
    expect(defaultComputeRequestHash({ a: 1 })).toBe(computeRequestHash({ a: 1 }));
    expect(defaultComputeRequestHash({ a: 1 })).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(defaultComputeRequestHash({ a: 1 })).not.toBe(defaultComputeRequestHash({ a: 2 }));
  });

  it("rejects a missing op_id synchronously before queueing", () => {
    const opened = openState();
    const queue = startQueue(opened);
    let executed = false;
    expect(() =>
      queue.submitOperation({
        opId: "",
        kind: "claim",
        request: { task: "T07" },
        execute: () => {
          executed = true;
          return { ok: true };
        },
      }),
    ).toThrow(MissingOpIdError);
    expect(executed).toBe(false);
    expect(queue.getQueueMetrics().runtimeDepth).toBe(0);
  });

  it("replays a stored receipt and rejects a reused op_id with a different request", async () => {
    const opened = openState({
      extraSql: "CREATE TABLE claims (task TEXT PRIMARY KEY, epoch INTEGER NOT NULL) STRICT;",
    });
    const queue = startQueue(opened);
    let executions = 0;
    const first = await queue.submitOperation({
      opId: "op-claim-1",
      kind: "claim",
      request: { task: "T07", epoch: 1 },
      execute: (tx) => {
        executions += 1;
        tx.prepare("INSERT INTO claims (task, epoch) VALUES (:task, :epoch)").run({
          task: "T07",
          epoch: 1,
        });
        tx.setCommittedRev(4);
        return { claimed: true, epoch: 1 };
      },
    });
    const replay = await queue.submitOperation({
      opId: "op-claim-1",
      kind: "claim",
      request: { task: "T07", epoch: 1 },
      execute: () => {
        executions += 1;
        return { claimed: false };
      },
    });
    const reused = queue.submitOperation({
      opId: "op-claim-1",
      kind: "claim",
      request: { task: "T07", epoch: 2 },
      execute: () => {
        executions += 1;
        return { claimed: true };
      },
    });

    expect(first.replayed).toBe(false);
    expect(first.committedRev).toBe(4);
    expect(first.result).toEqual({ claimed: true, epoch: 1 });
    expect(replay.replayed).toBe(true);
    expect(replay.result).toEqual(first.result);
    await expect(reused).rejects.toBeInstanceOf(OpIdReusedError);
    await expect(reused).rejects.toMatchObject({ opId: "op-claim-1", code: "op_id_reused" });
    expect(executions).toBe(1);
    expect(scalar(opened.database, "SELECT count(*) AS n FROM claims")).toBe(1);
    expect(scalar(opened.database, "SELECT count(*) AS n FROM operations")).toBe(1);
  });

  it("does not resolve a caller until COMMIT returns", async () => {
    const opened = openState();
    const seen = {
      samplesDuringCommit: -1,
      queue: undefined as CoordinatorWriteQueue | undefined,
    };
    opened.stateDb.execHook = (sql) => {
      if (/^\s*COMMIT\b/i.test(sql)) {
        seen.samplesDuringCommit = seen.queue?.getQueueMetrics().samples ?? -1;
      }
      opened.database.exec(sql);
    };
    const queue = startQueue(opened);
    seen.queue = queue;
    const receipt = await queue.submitOperation({
      opId: "op-commit-order",
      kind: "reserve",
      request: { reservation: "R1" },
      execute: () => ({ held: true }),
    });
    expect(receipt.result).toEqual({ held: true });
    expect(seen.samplesDuringCommit).toBe(0);
    expect(queue.getQueueMetrics().samples).toBe(1);
  });

  it("prunes operations older than 30 days and leaves permanent receipts", async () => {
    const opened = openState({
      extraSql: `
        CREATE TABLE candidates (id TEXT PRIMARY KEY);
        CREATE TABLE check_results (id TEXT PRIMARY KEY);
        CREATE TABLE effects (id TEXT PRIMARY KEY);
      `,
    });
    const now = 1_800_000_000_000;
    const cutoff = now - OPERATIONS_RETENTION_MS;
    opened.database.exec(`
      INSERT INTO operations (op_id, kind, request_hash, result, committed_rev, created_at)
      VALUES
        ('old', 'claim', 'h', '{}', 1, ${cutoff - 1}),
        ('edge', 'claim', 'h', '{}', 1, ${cutoff});
      INSERT INTO candidates (id) VALUES ('C1');
      INSERT INTO check_results (id) VALUES ('K1');
      INSERT INTO effects (id) VALUES ('E1');
    `);
    const queue = startQueue(opened, {
      stateDb: opened.stateDb,
      now: () => now,
      pruneIntervalMs: Number.POSITIVE_INFINITY,
    });
    const removed = await queue.pruneOldOperations(now);
    expect(removed).toBe(1);
    const remaining = opened.database
      .prepare("SELECT op_id FROM operations ORDER BY op_id")
      .all() as Array<{ op_id: string }>;
    expect(remaining.map((row) => row.op_id)).toEqual(["edge"]);
    expect(scalar(opened.database, "SELECT count(*) AS n FROM candidates")).toBe(1);
    expect(scalar(opened.database, "SELECT count(*) AS n FROM check_results")).toBe(1);
    expect(scalar(opened.database, "SELECT count(*) AS n FROM effects")).toBe(1);
  });

  it("prunes aged operations at idle without a direct prune call", () => {
    const opened = openState();
    openDatabases.push(opened);
    const now = 1_700_000_000_000;
    opened.database
      .prepare(
        "INSERT INTO operations (op_id, kind, request_hash, result, committed_rev, created_at) VALUES ('stale', 'claim', 'h', '{}', NULL, ?)",
      )
      .run(now - OPERATIONS_RETENTION_MS - 5);
    opened.database.exec("CREATE TABLE candidates (id TEXT PRIMARY KEY)");
    opened.database.exec("INSERT INTO candidates (id) VALUES ('keep')");
    const queue = new CoordinatorWriteQueue({
      stateDb: opened.stateDb,
      coalesceWindowMs: 0,
      pruneIntervalMs: 0,
      now: () => now,
    });
    queues.push(queue);
    expect(scalar(opened.database, "SELECT count(*) AS n FROM operations")).toBe(0);
    expect(scalar(opened.database, "SELECT count(*) AS n FROM candidates")).toBe(1);
  });
});
