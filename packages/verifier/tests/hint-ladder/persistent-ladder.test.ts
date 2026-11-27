import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { bindCoordinatorWriteQueue, openProjectStateDb, type SqliteConnection } from "@ef-harness/db";
import { SecretRedactor } from "@ef-harness/shared-contracts";
import { afterEach, describe, expect, it } from "vitest";
import { DisputeTestRouter, PersistentHintLadder } from "../../src/hint-ladder/live-bind.js";

const SECRET = ["c25", "vault", "marker", "alpha"].join("-");
const SEALED_FILE = "sealed-oracle.test.ts";
const SEALED_TOKEN = "INPUT_ORANGE";

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

describe("persistent hint ladder", () => {
  it("stores a redacted step-1 hint and leaves sealed examples out of it", async () => {
    const opened = openLadder();
    const step = await opened.ladder.processHiddenFailure({
      taskId: "T07",
      attemptId: "A1",
      model: "mid-model",
      workerLevel: "Mid",
      briefVersion: 1,
      ruleId: "R17",
      ruleText: `Orders close at 10:45 Europe/Berlin ${SECRET}`,
      checkId: "H1",
      failureType: "wrong_value",
      fingerprint: "fp-a",
      filePath: SEALED_FILE,
      pool: [
        { checkId: "H1", input: { token: SEALED_TOKEN }, expectedOutput: { token: "EXPECTED_ORANGE" } },
        { checkId: "H2", input: { token: "INPUT_BLUE" }, expectedOutput: { token: "EXPECTED_BLUE" } },
      ],
    });
    expect(step.kind).toBe("step_1");
    if (step.kind !== "step_1") return;
    expect(Object.keys(step.hint).sort()).toEqual(["failureType", "ruleId", "ruleText"]);
    expect(step.hint.ruleText).toContain("[REDACTED:VAULT]");
    expect(step.hint.ruleText).not.toContain(SECRET);
    const hint = JSON.stringify(step.hint);
    expect(hint).not.toContain(SEALED_FILE);
    expect(hint).not.toContain(SEALED_TOKEN);
    expect(hint).not.toContain("EXPECTED_ORANGE");
    const stored = opened.writer
      .prepare(`SELECT result FROM operations WHERE kind = 'hint_ladder'`)
      .all()
      .map((row) => text(row, "result"))
      .join("\n");
    expect(stored).toContain("[REDACTED:VAULT]");
    expect(stored).not.toContain(SECRET);
    expect(text(opened.writer.prepare(`SELECT state FROM task_runtime WHERE task = 'T07'`).get(), "state")).toBe(
      "CODING",
    );
  });

  it("redacts a dispute counterexample before the inbox row is stored", async () => {
    const opened = openLadder();
    const router = new DisputeTestRouter(opened.ladder);
    const record = await router.handleTestDispute({
      taskId: "T07",
      attemptId: "A1",
      referenceId: "R17",
      counterexample: { note: SECRET },
    });
    expect(JSON.stringify(record.counterexample)).toContain("[REDACTED:VAULT]");
    expect(JSON.stringify(record)).not.toContain(SECRET);
    const payload = text(opened.writer.prepare(`SELECT payload FROM inbox_items`).get(), "payload");
    expect(payload).toContain("[REDACTED:VAULT]");
    expect(payload).not.toContain(SECRET);
  });
});

function openLadder(): {
  readonly ladder: PersistentHintLadder;
  readonly writer: SqliteConnection;
} {
  const root = mkdtempSync(path.join(tmpdir(), "ef-c25-hint-"));
  const opened: {
    stateDb?: ReturnType<typeof openProjectStateDb>;
    queue?: ReturnType<typeof bindCoordinatorWriteQueue>;
  } = {};
  closers.push(async () => {
    if (opened.queue) await opened.queue.drainAndClose();
    if (opened.stateDb && !opened.stateDb.isClosed()) opened.stateDb.close();
    rmSync(root, { recursive: true, force: true });
  });
  const stateDb = openProjectStateDb({
    projectId: `C25H${path.basename(root).replace(/[^A-Za-z0-9._-]/g, "").slice(-24)}`,
    rootDir: path.join(root, "state"),
  });
  opened.stateDb = stateDb;
  seedHint(stateDb.writer);
  const queue = bindCoordinatorWriteQueue(stateDb, {
    coalesceWindowMs: 0,
    pruneIntervalMs: Number.POSITIVE_INFINITY,
  });
  opened.queue = queue;
  const redactor = new SecretRedactor();
  redactor.register("VAULT", SECRET);
  const ladder = new PersistentHintLadder({
    stateDb,
    queue,
    redactor,
    runner: { run: () => ({ token: "actual" }) },
  });
  return { ladder, writer: stateDb.writer };
}

function seedHint(writer: SqliteConnection): void {
  writer.exec("BEGIN IMMEDIATE");
  try {
    writer
      .prepare(
        `INSERT INTO change_sets(id, rev, origin, author, created_at) VALUES ('CS-1', 1, 'planner', 'test', 1)`,
      )
      .run();
    writer.prepare(`UPDATE meta SET value = ? WHERE key = 'last_rev'`).run(["1"]);
    const node = writer.prepare(
      `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev)
       VALUES (?, ?, 1, ?, ?, ?, ?, 'CS-1', 1, 1)`,
    );
    node.run(["F12", "feature", "h-F12", "Kitchen print", "", JSON.stringify({ feature: "F12" })]);
    node.run([
      "R17",
      "rule",
      "h-R17",
      "Cutoff rule",
      "Orders close at 10:45 Europe/Berlin",
      JSON.stringify({ feature: "F12" }),
    ]);
    node.run(["T07", "task", "h-T07", "Kitchen print page", "", JSON.stringify({ feature: "F12" })]);
    node.run(["H1", "check", "h-H1", "H1", "", JSON.stringify({ feature: "F12", rule_id: "R17" })]);
    const edge = writer.prepare(
      `INSERT INTO edges(src, type, dst, change_set, valid_from_rev) VALUES (?, ?, ?, 'CS-1', 1)`,
    );
    edge.run(["T07", "obeys", "R17"]);
    edge.run(["H1", "verifies", "R17"]);
    writer
      .prepare(
        `INSERT INTO task_runtime(task, feature, state, level, epoch, submission_pending, updated_rev)
         VALUES ('T07', 'F12', 'CLEAN_VERIFY', 'Junior', 1, 1, 1)`,
      )
      .run();
    writer
      .prepare(
        `INSERT INTO attempts(id, task, n, epoch, brief_version, runtime, model, connection, base_commit, state, started_at)
         VALUES ('A1', 'T07', 1, 1, 1, 'own', 'mid-model', 'c', 'abc', 'running', 1)`,
      )
      .run();
    writer.prepare(`UPDATE task_runtime SET holder_attempt = 'A1' WHERE task = 'T07'`).run();
    writer.exec("COMMIT");
  } catch (error) {
    writer.exec("ROLLBACK");
    throw error;
  }
}

function text(row: unknown, key: string): string {
  if (row === null || typeof row !== "object") throw new Error(`missing row for ${key}`);
  const value = Reflect.get(row, key);
  if (typeof value !== "string") throw new Error(`${key} is not text`);
  return value;
}
