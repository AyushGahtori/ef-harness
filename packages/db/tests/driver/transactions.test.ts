import { afterEach, describe, expect, it } from "vitest";
import {
  DeferredBeginForbiddenError,
  ForeignKeyConstraintError,
  NestedImmediateTransactionError,
  SqliteBusyError,
  createNodeSqliteBackend,
  openDatabase,
  runImmediateTx,
  runReadOnlyTx,
  runSavepoint,
  type SqliteBackendFactory,
} from "../../src/driver/index.js";

const opened: Array<{ close: () => void }> = [];

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
});

describe("transactions and savepoints", () => {
  it("commits BEGIN IMMEDIATE work and rolls back when the body throws", () => {
    const db = track(openDatabase({ location: ":memory:", role: "telemetry" }));
    db.exec("CREATE TABLE docs(id INTEGER PRIMARY KEY, body TEXT)");
    runImmediateTx(db, () => {
      db.run("INSERT INTO docs(body) VALUES ('kept')");
    });
    expect(() =>
      runImmediateTx(db, () => {
        db.run("INSERT INTO docs(body) VALUES ('lost')");
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(db.all("SELECT body FROM docs")).toEqual([{ body: "kept" }]);
    expect(db.inImmediateTransaction).toBe(false);
  });

  it("forbids nested BEGIN IMMEDIATE and rolls a savepoint back without aborting the outer transaction", () => {
    const db = track(openDatabase({ location: ":memory:", role: "telemetry" }));
    db.exec("CREATE TABLE docs(id INTEGER PRIMARY KEY, body TEXT)");
    runImmediateTx(db, () => {
      db.run("INSERT INTO docs(body) VALUES ('outer')");
      expect(() => runImmediateTx(db, () => undefined)).toThrow(NestedImmediateTransactionError);
      expect(() =>
        runSavepoint(db, () => {
          db.run("INSERT INTO docs(body) VALUES ('inner')");
          throw new Error("savepoint failed");
        }),
      ).toThrow("savepoint failed");
      runSavepoint(db, () => {
        db.run("INSERT INTO docs(body) VALUES ('after')");
      });
    });
    expect(db.all("SELECT body FROM docs ORDER BY id")).toEqual([{ body: "outer" }, { body: "after" }]);
  });

  it("starts an immediate transaction when a savepoint is requested outside one", () => {
    const db = track(openDatabase({ location: ":memory:", role: "telemetry" }));
    db.exec("CREATE TABLE docs(id INTEGER PRIMARY KEY, body TEXT)");
    runSavepoint(db, () => {
      expect(db.inImmediateTransaction).toBe(true);
      db.run("INSERT INTO docs(body) VALUES ('alone')");
    });
    expect(db.get("SELECT body FROM docs")).toEqual({ body: "alone" });
  });

  it("keeps read-only transactions from upgrading to a write", () => {
    const db = track(openDatabase({ location: ":memory:", role: "telemetry" }));
    db.exec("CREATE TABLE docs(id INTEGER PRIMARY KEY, body TEXT)");
    db.run("INSERT INTO docs(body) VALUES ('stable')");
    const row = runReadOnlyTx(db, () => db.get("SELECT body FROM docs"));
    expect(row).toEqual({ body: "stable" });
    expect(() =>
      runReadOnlyTx(db, () => {
        db.run("INSERT INTO docs(body) VALUES ('nope')");
      }),
    ).toThrow(/readonly|query_only/i);
    expect(db.all("SELECT body FROM docs")).toEqual([{ body: "stable" }]);
    expect(cellQueryOnly(db)).toBe(0);
  });

  it("retries a whole transaction on SQLITE_BUSY and then surfaces a persistent lock", () => {
    const sleeps: number[] = [];
    const db = track(
      openDatabase({
        location: ":memory:",
        role: "telemetry",
        backend: failBeginImmediate(createNodeSqliteBackend, 2),
      }),
    );
    db.exec("CREATE TABLE docs(id INTEGER PRIMARY KEY, body TEXT)");
    const runs: number[] = [];
    runImmediateTx(
      db,
      () => {
        runs.push(1);
        db.run("INSERT INTO docs(body) VALUES ('retried')");
      },
      { sleep: (ms) => sleeps.push(ms), random: () => 0 },
    );
    expect(runs).toEqual([1]);
    expect(sleeps.length).toBe(2);
    expect(db.get("SELECT body FROM docs")).toEqual({ body: "retried" });

    const locked = track(
      openDatabase({
        location: ":memory:",
        role: "telemetry",
        backend: failBeginImmediate(createNodeSqliteBackend, 10),
      }),
    );
    expect(() =>
      runImmediateTx(locked, () => undefined, { maxAttempts: 2, sleep: () => undefined, random: () => 0 }),
    ).toThrow(SqliteBusyError);
  });

  it("rolls back a deferred foreign-key failure at COMMIT and reports diagnostics", () => {
    const db = track(openDatabase({ location: ":memory:", role: "state" }));
    db.exec("CREATE TABLE parent(id INTEGER PRIMARY KEY)");
    db.exec(
      "CREATE TABLE child(id INTEGER PRIMARY KEY, parent INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED)",
    );
    let caught: unknown;
    try {
      runImmediateTx(db, () => {
        db.run("INSERT INTO child(id, parent) VALUES (1, 2)");
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ForeignKeyConstraintError);
    const fk = caught as ForeignKeyConstraintError;
    expect(fk.diagnostics.length).toBeGreaterThan(0);
    expect(fk.diagnostics[0]?.table).toBe("child");
    expect(db.inTransaction).toBe(false);
    expect(db.get("SELECT count(*) AS n FROM child")).toEqual({ n: 0 });
    expect(() => db.exec("BEGIN")).toThrow(DeferredBeginForbiddenError);
  });

  it("supports connection.transaction(), connection.savepoint(), positional arrays, and named params", () => {
    const db = track(openDatabase({ location: ":memory:", role: "telemetry" }));
    db.exec("CREATE TABLE docs(id INTEGER PRIMARY KEY, body TEXT NOT NULL)");
    db.transaction(() => {
      const insert = db.prepare("INSERT INTO docs(id, body) VALUES (:id, :body)");
      try {
        insert.run({ id: 1, body: "named" });
      } finally {
        insert.finalize();
      }
      db.savepoint(() => {
        const pos = db.prepare("INSERT INTO docs(id, body) VALUES (?, ?)");
        try {
          pos.run([2, "positional"]);
        } finally {
          pos.finalize();
        }
      });
      expect(() =>
        db.savepoint(() => {
          db.run("INSERT INTO docs(id, body) VALUES (?, ?)", [3, "rolled-back"]);
          throw new Error("abort savepoint");
        }),
      ).toThrow("abort savepoint");
    });
    expect(db.all("SELECT id, body FROM docs ORDER BY id")).toEqual([
      { id: 1, body: "named" },
      { id: 2, body: "positional" },
    ]);
  });
});

function track<T extends { close: () => void }>(db: T): T {
  opened.push(db);
  return db;
}

function cellQueryOnly(db: { pragma(source: string): unknown }): number {
  const row = db.pragma("query_only");
  if (row === null || typeof row !== "object") return -1;
  const value = Object.values(row)[0];
  return typeof value === "number" ? value : Number(value);
}

function failBeginImmediate(inner: SqliteBackendFactory, failures: number): SqliteBackendFactory {
  return (options) => {
    const backend = inner(options);
    let remaining = failures;
    const exec = backend.exec.bind(backend);
    backend.exec = (sql: string) => {
      if (remaining > 0 && /^\s*begin\s+immediate\b/i.test(sql)) {
        remaining -= 1;
        const error = new Error("database is locked");
        Object.assign(error, { errcode: 5, code: "ERR_SQLITE_ERROR" });
        throw error;
      }
      exec(sql);
    };
    return backend;
  };
}
