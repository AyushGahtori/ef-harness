import { afterEach, describe, expect, it } from "vitest";
import { splitSearchText } from "@ef-harness/shared-contracts";
import {
  AttachedDatabaseForbiddenError,
  ReaderBudgetError,
  ReaderPool,
  ReaderTimeoutError,
  WorkerReaderPool,
  openDatabase,
} from "../../src/driver/index.js";
import { tempDatabaseDir } from "./temp.js";

const closers: Array<() => Promise<void> | void> = [];
const temps: Array<{ cleanup: () => void }> = [];

afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  for (const temp of temps.splice(0)) temp.cleanup();
});

describe("worker reader pool", () => {
  it("cancels an infinite recursive CTE within the UI budget and leaves WAL checkpoints unblocked", async () => {
    const temp = trackTemp();
    const location = temp.file("state.db");
    const writer = openDatabase({ location, role: "state" });
    closers.unshift(() => writer.close());
    writer.exec("CREATE TABLE docs(id INTEGER PRIMARY KEY, body TEXT)");
    writer.run("INSERT INTO docs(body) VALUES ('visible')");
    const pool = new WorkerReaderPool({ location, role: "state", size: 2 });
    closers.unshift(() => pool.close());

    const warmup = await pool.query({
      sql: "SELECT ef_search_text(?) AS text",
      params: ["toPrintRows"],
      class: "ui",
      timeoutMs: 200,
    });
    expect(warmup).toEqual([{ text: splitSearchText("toPrintRows") }]);

    const acronym = await pool.query({
      sql: "SELECT ef_search_text(?) AS text",
      params: ["XMLHttpRequest"],
      class: "ui",
      timeoutMs: 200,
    });
    expect(acronym).toEqual([{ text: splitSearchText("XMLHttpRequest") }]);
    expect((acronym[0] as { text: string }).text).toContain("XML Http Request");

    const mixed = await pool.query({
      sql: "SELECT ef_search_text(?) AS text",
      params: ["parseXMLHttpRequest_v2"],
      class: "ui",
      timeoutMs: 200,
    });
    expect(mixed).toEqual([{ text: splitSearchText("parseXMLHttpRequest_v2") }]);

    const started = performance.now();
    await expect(
      pool.query({
        sql: "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT x FROM c",
        class: "ui",
        timeoutMs: 200,
      }),
    ).rejects.toBeInstanceOf(ReaderTimeoutError);
    expect(performance.now() - started).toBeLessThan(350);

    const checkpointStarted = performance.now();
    const checkpoint = writer.pragma("wal_checkpoint(TRUNCATE)") as {
      busy: number;
      log: number;
      checkpointed: number;
    };
    expect(performance.now() - checkpointStarted).toBeLessThan(200);
    expect(checkpoint.busy).toBe(0);

    const followUp = await pool.query({
      sql: "SELECT body FROM docs",
      class: "export",
      timeoutMs: 2_000,
    });
    expect(followUp).toEqual([{ body: "visible" }]);
  });

  it("rejects missing, unbounded, and over-budget reader timeouts", async () => {
    const temp = trackTemp();
    const location = temp.file("state.db");
    const writer = openDatabase({ location, role: "telemetry" });
    closers.unshift(() => writer.close());
    const pool = new ReaderPool({ location, role: "telemetry", size: 1 });
    closers.unshift(() => pool.close());
    await expect(
      pool.query({ sql: "SELECT 1", class: "ui", timeoutMs: 0 }),
    ).rejects.toBeInstanceOf(ReaderBudgetError);
    await expect(
      pool.query({ sql: "SELECT 1", class: "ui", timeoutMs: 201 }),
    ).rejects.toBeInstanceOf(ReaderBudgetError);
    await expect(
      pool.query({ sql: "SELECT 1", class: "export", timeoutMs: 2_001 }),
    ).rejects.toBeInstanceOf(ReaderBudgetError);
    await expect(
      pool.query({
        sql: "ATTACH DATABASE ':memory:' AS other",
        class: "ui",
        timeoutMs: 200,
      }),
    ).rejects.toBeInstanceOf(AttachedDatabaseForbiddenError);
  });
});

function trackTemp() {
  const temp = tempDatabaseDir();
  temps.push(temp);
  return temp;
}
