import { afterEach, describe, expect, it } from "vitest";

import { CoordinatorWriteQueue, canonicalQuery } from "../../src/write-queue/index.js";
import { openState, scalar, type OpenedState } from "./state-db.js";

const KNOWLEDGE_DDL = `
CREATE TABLE nodes (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  content_hash TEXT NOT NULL
) STRICT;
CREATE TABLE node_changes (
  change_set TEXT NOT NULL,
  id TEXT NOT NULL,
  old_version INTEGER,
  new_version INTEGER,
  class TEXT NOT NULL,
  PRIMARY KEY (change_set, id)
) STRICT, WITHOUT ROWID;
CREATE TABLE read_sets (
  attempt TEXT NOT NULL,
  node TEXT NOT NULL,
  version INTEGER NOT NULL,
  hash TEXT NOT NULL,
  how TEXT NOT NULL,
  PRIMARY KEY (attempt, node, version)
) STRICT, WITHOUT ROWID;
CREATE INDEX read_sets_by_node ON read_sets(node, version);
CREATE TABLE attempts (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL
) STRICT;
CREATE TABLE reverification (
  attempt TEXT NOT NULL,
  node TEXT NOT NULL,
  PRIMARY KEY (attempt, node)
) STRICT, WITHOUT ROWID;
INSERT INTO nodes (id, version, content_hash) VALUES ('R17', 1, 'h-R17-1');
INSERT INTO attempts (id, state) VALUES ('A-T07-1', 'running');
INSERT INTO read_sets (attempt, node, version, hash, how)
VALUES ('A-T07-1', 'R17', 1, 'h-R17-1', 'pushed');
`;

const openDatabases: OpenedState[] = [];
const queues: CoordinatorWriteQueue[] = [];

afterEach(async () => {
  for (const queue of queues.splice(0)) await queue.drainAndClose();
  for (const opened of openDatabases.splice(0)) opened.close();
});

function propagationHook(opened: OpenedState) {
  return (event: {
    changedNodes: readonly { nodeId: string; changeClass: string; attempts: readonly string[] }[];
  }): void => {
    for (const node of event.changedNodes) {
      if (node.changeClass !== "breaking" && node.changeClass !== "retired") continue;
      for (const attempt of node.attempts) {
        opened.database
          .prepare("INSERT OR IGNORE INTO reverification (attempt, node) VALUES (?, ?)")
          .run(attempt, node.nodeId);
      }
    }
  };
}

function breakingChange(tx: {
  exec(sql: string): void;
  prepare(sql: string): { run(params?: Record<string, string | number | bigint | null>): unknown };
  setCommittedRev(rev: number): void;
  recordChangedNode(nodeId: string, changeClass: "breaking"): void;
}): { changeSet: string; node: string; version: number } {
  tx.exec("UPDATE nodes SET version = 2, content_hash = 'h-R17-2' WHERE id = 'R17'");
  tx.prepare(
    `INSERT INTO node_changes (change_set, id, old_version, new_version, class)
     VALUES ('CS-R17', 'R17', 1, 2, 'breaking')`,
  ).run();
  tx.recordChangedNode("R17", "breaking");
  tx.setCommittedRev(2);
  return { changeSet: "CS-R17", node: "R17", version: 2 };
}

function acceptTask(tx: {
  prepare(sql: string): {
    all(params?: Record<string, string | number | bigint | null>): readonly unknown[];
    run(params?: Record<string, string | number | bigint | null>): unknown;
  };
}): { accepted: boolean; attempt: string } {
  const stale = tx.prepare(canonicalQuery("stale_reads_for_acceptance")).all({ attempt: "A-T07-1" });
  if (stale.length > 0) throw new Error("stale read set");
  tx.prepare("UPDATE attempts SET state = 'accepted' WHERE id = :id").run({ id: "A-T07-1" });
  return { accepted: true, attempt: "A-T07-1" };
}

describe("write-queue knowledge barrier", () => {
  it("rejects T07 when breaking R17 commits first", async () => {
    const opened = openState({ extraSql: KNOWLEDGE_DDL });
    openDatabases.push(opened);
    const queue = new CoordinatorWriteQueue({
      stateDb: opened.stateDb,
      coalesceWindowMs: 0,
      pruneIntervalMs: Number.POSITIVE_INFINITY,
      onKnowledgePropagated: propagationHook(opened),
    });
    queues.push(queue);
    const barrier = queue.submitKnowledgeBarrier({
      opId: "op-r17",
      kind: "knowledge_change",
      request: { node: "R17", version: 2, class: "breaking" },
      execute: breakingChange,
    });
    const acceptance = queue.submitOperation({
      opId: "op-t07",
      kind: "accept",
      request: { task: "T07", attempt: "A-T07-1" },
      execute: acceptTask,
    });
    const barrierReceipt = await barrier;
    await expect(acceptance).rejects.toThrow(/stale read set/);
    expect(barrierReceipt.result).toEqual({ changeSet: "CS-R17", node: "R17", version: 2 });
    expect(scalar(opened.database, "SELECT version AS n FROM nodes WHERE id = 'R17'")).toBe(2);
    const attempt = opened.database.prepare("SELECT state FROM attempts WHERE id = 'A-T07-1'").get() as
      | { state: string }
      | undefined;
    expect(attempt?.state).toBe("running");
    expect(scalar(opened.database, "SELECT count(*) AS n FROM reverification")).toBe(1);
    expect(opened.commits.count).toBe(2);
  });

  it("accepts T07 first and schedules re-verification after R17 commits", async () => {
    const opened = openState({ extraSql: KNOWLEDGE_DDL });
    openDatabases.push(opened);
    const queue = new CoordinatorWriteQueue({
      stateDb: opened.stateDb,
      coalesceWindowMs: 0,
      pruneIntervalMs: Number.POSITIVE_INFINITY,
      onKnowledgePropagated: propagationHook(opened),
    });
    queues.push(queue);
    const acceptance = queue.submitOperation({
      opId: "op-t07",
      kind: "accept",
      request: { task: "T07", attempt: "A-T07-1" },
      execute: acceptTask,
    });
    const barrier = queue.submitKnowledgeBarrier({
      opId: "op-r17",
      kind: "knowledge_change",
      request: { node: "R17", version: 2, class: "breaking" },
      execute: breakingChange,
    });
    await expect(acceptance).resolves.toMatchObject({ result: { accepted: true } });
    await barrier;
    const attempt = opened.database.prepare("SELECT state FROM attempts WHERE id = 'A-T07-1'").get() as
      | { state: string }
      | undefined;
    expect(attempt?.state).toBe("accepted");
    expect(scalar(opened.database, "SELECT version AS n FROM nodes WHERE id = 'R17'")).toBe(2);
    const scheduled = opened.database
      .prepare("SELECT attempt, node FROM reverification")
      .get() as { attempt: string; node: string } | undefined;
    expect(scheduled).toEqual({ attempt: "A-T07-1", node: "R17" });
    expect(opened.commits.count).toBe(2);
  });

  it("keeps a committed barrier receipt when post-commit propagation throws, then retries", async () => {
    const opened = openState({ extraSql: KNOWLEDGE_DDL });
    openDatabases.push(opened);
    const logs: string[] = [];
    let calls = 0;
    const queue = new CoordinatorWriteQueue({
      stateDb: opened.stateDb,
      coalesceWindowMs: 0,
      pruneIntervalMs: Number.POSITIVE_INFINITY,
      propagationRetryDelayMs: 15,
      logger: {
        error: (entry) => {
          logs.push(entry.event);
        },
      },
      onKnowledgePropagated: () => {
        calls += 1;
        if (calls === 1) throw new Error("propagation boom");
      },
    });
    queues.push(queue);
    const receipt = await queue.submitKnowledgeBarrier({
      opId: "op-r17-retry",
      kind: "knowledge_change",
      request: { node: "R17", version: 2 },
      execute: breakingChange,
    });
    expect(receipt.result.version).toBe(2);
    expect(logs).toContain("knowledge_propagation_failed");
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(scalar(opened.database, "SELECT version AS n FROM nodes WHERE id = 'R17'")).toBe(2);
  });
});
