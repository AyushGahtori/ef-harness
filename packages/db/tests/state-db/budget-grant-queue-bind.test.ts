import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GlobalBrokerDb } from "../../src/auxiliary-dbs/index.js";
import { bindBrokerGrantIssuer, bindProjectGrantReceiver } from "../../src/grants/index.js";
import { bindBudgetLedger } from "../../src/ledger/index.js";
import { openProjectStateDb } from "../../src/state-db/index.js";
import { OpIdReusedError, bindCoordinatorWriteQueue } from "../../src/write-queue/index.js";

const closers: Array<() => Promise<void> | void> = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

function textCell(row: unknown, key: string): string {
  if (row === null || typeof row !== "object") throw new Error(`expected a row when reading ${key}`);
  const value = Reflect.get(row, key);
  if (typeof value !== "string") throw new Error(`${key} is not text`);
  return value;
}

function numberCell(row: unknown, key: string): number {
  if (row === null || typeof row !== "object") throw new Error(`expected a row when reading ${key}`);
  const value = Reflect.get(row, key);
  if (typeof value === "bigint") return Number(value);
  if (typeof value !== "number") throw new Error(`${key} is not a number`);
  return value;
}

describe("ProjectStateDb budget, grants, and write queue", () => {
  it("reserves the last micro-USD once, shares the writer, and hashes op_id with sha256", async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-c09-state-"));
    dirs.push(rootDir);
    const stateDb = openProjectStateDb({ projectId: "C09State", rootDir });
    const broker = GlobalBrokerDb.open({ root: path.join(rootDir, "broker") });
    const queue = bindCoordinatorWriteQueue(stateDb, {
      coalesceWindowMs: 0,
      pruneIntervalMs: Number.POSITIVE_INFINITY,
    });
    closers.unshift(async () => {
      await queue.drainAndClose();
      if (!stateDb.isClosed()) stateDb.close();
      broker.close();
    });

    const ledger = bindBudgetLedger(stateDb);
    ledger.registerCurrency("usd");
    ledger.createBudgetScope({
      scopeKind: "project",
      scopeId: "P1",
      currency: "usd",
      limitUnits: 1,
    });

    let wins = 0;
    let blocks = 0;
    let busy = 0;
    for (let index = 0; index < 50; index += 1) {
      try {
        const result = ledger.reserveAcrossScopes({
          reservationId: `R${index}`,
          purpose: "model_call",
          currency: "usd",
          amountUnits: 1,
          scopeKind: "project",
          scopeId: "P1",
          createdAt: index + 1,
        });
        if (result.ok) wins += 1;
        else blocks += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/SQLITE_BUSY|database is locked/u.test(message)) busy += 1;
        else throw error;
      }
    }
    expect(wins).toBe(1);
    expect(blocks).toBe(49);
    expect(busy).toBe(0);

    const snapshot = ledger.getScopeSnapshot("project", "P1");
    expect(snapshot.hardStop).toBe(true);
    expect(snapshot.currencies).toHaveLength(1);
    expect(snapshot.currencies[0]?.reservedUnits).toBe(1);
    expect(snapshot.currencies[0]?.remainingUnits).toBe(0);
    expect(snapshot.currencies[0]?.spentUnits).toBe(0);
    expect(
      numberCell(
        stateDb.writer.get(
          "SELECT reserved_units AS n FROM budgets WHERE scope_kind = 'project' AND scope_id = 'P1' AND currency = 'usd'",
        ),
        "n",
      ),
    ).toBe(1);

    const first = queue.submitOperationSync({
      opId: "op-note-1",
      kind: "note",
      request: { task: "T09", epoch: 1 },
      execute: () => ({ noted: true }),
    });
    expect(first.replayed).toBe(false);
    expect(first.requestHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(first.result).toEqual({ noted: true });

    const replay = await queue.submitOperation({
      opId: "op-note-1",
      kind: "note",
      request: { epoch: 1, task: "T09" },
      execute: () => ({ noted: false }),
    });
    expect(replay.replayed).toBe(true);
    expect(replay.result).toEqual({ noted: true });
    expect(replay.requestHash).toBe(first.requestHash);
    await expect(
      queue.submitOperation({
        opId: "op-note-1",
        kind: "note",
        request: { task: "T09", epoch: 2 },
        execute: () => ({ noted: true }),
      }),
    ).rejects.toBeInstanceOf(OpIdReusedError);
    expect(numberCell(stateDb.writer.get("SELECT count(*) AS n FROM operations"), "n")).toBe(1);

    broker.registerProject({
      id: "C09State",
      path: rootDir,
      displayName: "C09",
      schemaVersion: 1,
    });
    broker.writer.exec(
      `INSERT INTO connections (id, provider, route, currency, scale, enabled, created_at)
       VALUES ('conn-1', 'openai', 'api_key', 'usd', 1000000, 1, 1)`,
    );
    broker.writer.exec(
      `INSERT INTO connection_windows (
         connection, window_kind, window_start, window_end, limit_units, estimated_units
       ) VALUES ('conn-1', 'weekly', 0, 10000000, 100, 0)`,
    );
    const issued = await bindBrokerGrantIssuer(broker, {
      deliver: () => undefined,
    }).issueGrant({
      grantId: "G1",
      projectId: "C09State",
      connectionId: "conn-1",
      currency: "usd",
      units: 5,
      concurrency: 1,
      priorityClass: "interactive",
      issuedAt: 1000,
      expiresAt: 2000,
    });
    expect(textCell(broker.writer.get("SELECT state FROM grants WHERE id = 'G1'"), "state")).toBe("issued");
    expect(issued.units).toBe(5);

    const deposited = await bindProjectGrantReceiver(stateDb, { deliver: () => undefined }, "C09State").depositGrant(
      issued,
    );
    expect(deposited).toEqual({ type: "GrantDepositedAck", grantId: "G1" });
    expect(
      textCell(
        stateDb.writer.get("SELECT scope_kind FROM budgets WHERE scope_kind = 'grant' AND scope_id = 'G1'"),
        "scope_kind",
      ),
    ).toBe("grant");
    const databases = broker.writer.all("PRAGMA database_list");
    const attached = databases.filter((row) => {
      const name = row !== null && typeof row === "object" ? Reflect.get(row, "name") : undefined;
      return name !== "main" && name !== "temp";
    });
    expect(attached).toEqual([]);
  });
});
