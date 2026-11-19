import { existsSync, statSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  AttachedDatabaseForbiddenError,
  ConnectionClosedError,
  DeferredBeginForbiddenError,
  WalModeRequiredError,
  createBetterSqlite3Backend,
  createNodeSqliteBackend,
  openDatabase,
  type BetterSqlite3Constructor,
  type SqliteBackend,
  type SqliteBackendFactory,
} from "../../src/driver/index.js";
import { cell, tempDatabaseDir } from "./temp.js";

const opened: Array<{ close: () => void }> = [];
const temps: Array<{ cleanup: () => void }> = [];

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
  for (const temp of temps.splice(0)) temp.cleanup();
});

describe("connection pragmas", () => {
  it("enforces writer pragmas on state.db and global.db", () => {
    const temp = trackTemp();
    for (const role of ["state", "global"] as const) {
      const db = track(openDatabase({ location: temp.file(`${role}.db`), role }));
      expect(cell(db.pragma("journal_mode"))).toBe("wal");
      expect(cell(db.pragma("synchronous"))).toBe(2);
      expect(cell(db.pragma("foreign_keys"))).toBe(1);
      expect(cell(db.pragma("busy_timeout"))).toBe(5000);
      expect(cell(db.pragma("secure_delete"))).toBe(1);
      expect(cell(db.pragma("journal_size_limit"))).toBe(67108864);
      expect(cell(db.pragma("temp_store"))).toBe(2);
      expect(cell(db.pragma("query_only"))).toBe(0);
    }
  });

  it("uses WAL and NORMAL synchronous on telemetry.db and code-index.db", () => {
    const temp = trackTemp();
    for (const role of ["telemetry", "code-index"] as const) {
      const db = track(openDatabase({ location: temp.file(`${role}.db`), role }));
      expect(cell(db.pragma("journal_mode"))).toBe("wal");
      expect(cell(db.pragma("synchronous"))).toBe(1);
      expect(cell(db.pragma("foreign_keys"))).toBe(1);
      expect(cell(db.pragma("busy_timeout"))).toBe(5000);
    }
  });

  it("forces query_only and foreign keys on read-only opens", () => {
    const temp = trackTemp();
    const writer = track(openDatabase({ location: temp.file("state.db"), role: "state" }));
    writer.exec("CREATE TABLE docs(id INTEGER PRIMARY KEY, body TEXT)");
    const reader = track(
      openDatabase({ location: temp.file("state.db"), role: "state", access: "readonly" }),
    );
    expect(cell(reader.pragma("query_only"))).toBe(1);
    expect(cell(reader.pragma("foreign_keys"))).toBe(1);
    expect(() => reader.exec("INSERT INTO docs(body) VALUES ('no')")).toThrow(/readonly|query_only/i);
  });

  it("registers deterministic ef_search_text on writer and read-only state.db connections", () => {
    const temp = trackTemp();
    const writer = track(openDatabase({ location: temp.file("state.db"), role: "state" }));
    const reader = track(
      openDatabase({ location: temp.file("state.db"), role: "state", access: "readonly" }),
    );
    for (const db of [writer, reader]) {
      const row = db.get("SELECT ef_search_text(?) AS text", ["toPrintRows"]) as { text: string };
      expect(row.text).toContain("toPrintRows");
      expect(row.text.toLowerCase()).toContain("print");
      expect(row.text.toLowerCase()).toContain("rows");
    }
  });

  it("allows an in-memory state database whose journal mode stays memory", () => {
    const db = track(openDatabase({ location: ":memory:", role: "state" }));
    expect(cell(db.pragma("journal_mode"))).toBe("memory");
    expect(cell(db.pragma("synchronous"))).toBe(2);
  });

  it("throws WalModeRequiredError when journal_mode does not stay wal on disk", () => {
    const temp = trackTemp();
    expect(() =>
      openDatabase({
        location: temp.file("state.db"),
        role: "state",
        backend: lieAboutJournalMode(createNodeSqliteBackend),
      }),
    ).toThrow(WalModeRequiredError);
  });

  it("rejects ATTACH in exec and prepare", () => {
    const db = track(openDatabase({ location: ":memory:", role: "telemetry" }));
    expect(() => db.exec("ATTACH DATABASE ':memory:' AS other")).toThrow(AttachedDatabaseForbiddenError);
    expect(() => db.prepare("attach database ':memory:' as other")).toThrow(AttachedDatabaseForbiddenError);
    expect(() => db.exec("ATTACH 'side.db' AS other")).toThrow(AttachedDatabaseForbiddenError);
    db.exec("CREATE TABLE docs(id INTEGER PRIMARY KEY, body TEXT)");
    db.run("INSERT INTO docs(body) VALUES (?)", ["please ATTACH DATABASE later"]);
    expect(db.get("SELECT body FROM docs") ).toEqual({ body: "please ATTACH DATABASE later" });
  });

  it("rejects deferred BEGIN and allows BEGIN IMMEDIATE", () => {
    const db = track(openDatabase({ location: ":memory:", role: "telemetry" }));
    expect(() => db.exec("BEGIN")).toThrow(DeferredBeginForbiddenError);
    expect(() => db.exec("BEGIN DEFERRED")).toThrow(DeferredBeginForbiddenError);
    expect(() => db.exec("BEGIN TRANSACTION")).toThrow(DeferredBeginForbiddenError);
    db.exec("BEGIN IMMEDIATE");
    expect(db.inImmediateTransaction).toBe(true);
    db.exec("ROLLBACK");
    expect(db.inImmediateTransaction).toBe(false);
    db.exec("CREATE TABLE docs(id INTEGER PRIMARY KEY)");
    db.exec("CREATE TRIGGER guard AFTER INSERT ON docs BEGIN SELECT 1; END");
  });

  it("round-trips safe integers and preserves integers beyond MAX_SAFE_INTEGER", () => {
    const db = track(openDatabase({ location: ":memory:", role: "state" }));
    db.exec("CREATE TABLE amounts(id INTEGER PRIMARY KEY, micros INTEGER, ts INTEGER)");
    const inserted = db.run("INSERT INTO amounts(micros, ts) VALUES (?, ?)", [1_500_000, 1_700_000_000_000]);
    expect(inserted.changes).toBe(1);
    expect(inserted.lastInsertRowid).toBe(1);
    const row = db.get("SELECT micros, ts FROM amounts WHERE id = ?", [1]) as { micros: number; ts: number };
    expect(row).toEqual({ micros: 1_500_000, ts: 1_700_000_000_000 });
    expect(Number.isSafeInteger(row.ts)).toBe(true);
    const huge = BigInt(Number.MAX_SAFE_INTEGER) + 2n;
    db.run("INSERT INTO amounts(micros, ts) VALUES (?, ?)", [huge, 7]);
    const wide = db.get("SELECT micros FROM amounts WHERE id = ?", [2]) as { micros: bigint };
    expect(wide.micros).toBe(huge);
  });

  it("truncates the WAL on writer close and rejects later calls", () => {
    const temp = trackTemp();
    const location = temp.file("state.db");
    const db = openDatabase({ location, role: "state" });
    db.exec("CREATE TABLE docs(id INTEGER PRIMARY KEY, body TEXT)");
    db.run("INSERT INTO docs(body) VALUES ('kept')");
    db.close();
    const wal = `${location}-wal`;
    expect(!existsSync(wal) || statSync(wal).size === 0).toBe(true);
    expect(() => db.exec("SELECT 1")).toThrow(ConnectionClosedError);
    expect(() => db.close()).not.toThrow();
  });

  it("adapts a better-sqlite3-shaped driver without importing that package", () => {
    const fake = new FakeBetterDatabase();
    const db = track(
      openDatabase({
        location: ":memory:",
        role: "state",
        backend: createBetterSqlite3Backend(FakeBetterDatabase.ctor(fake)),
      }),
    );
    expect(fake.functions).toContain("ef_search_text:true");
    expect(fake.pragmas.some((entry) => entry.startsWith("journal_mode"))).toBe(true);
    db.exec("SELECT 1");
    expect(fake.execs).toContain("SELECT 1");
  });
});

function track<T extends { close: () => void }>(db: T): T {
  opened.push(db);
  return db;
}

function trackTemp() {
  const temp = tempDatabaseDir();
  temps.push(temp);
  return temp;
}

function lieAboutJournalMode(inner: SqliteBackendFactory): SqliteBackendFactory {
  return (options) => {
    const backend = inner(options);
    const read = backend.pragma.bind(backend);
    backend.pragma = (sql: string) => {
      if (/journal_mode/i.test(sql)) return { journal_mode: "delete" };
      return read(sql);
    };
    return backend;
  };
}

class FakeBetterDatabase {
  readonly pragmas: string[] = [];
  readonly execs: string[] = [];
  readonly functions: string[] = [];
  open = true;
  inTransaction = false;

  static ctor(fake: FakeBetterDatabase): BetterSqlite3Constructor {
    return class {
      constructor() {
        return fake;
      }
    } as unknown as BetterSqlite3Constructor;
  }

  pragma(source: string): unknown {
    this.pragmas.push(source);
    if (source.startsWith("journal_mode")) return [{ journal_mode: "memory" }];
    if (source === "synchronous") return [{ synchronous: 2 }];
    if (source === "foreign_keys") return [{ foreign_keys: 1 }];
    if (source === "busy_timeout") return [{ timeout: 5000 }];
    if (source === "secure_delete") return [{ secure_delete: 1 }];
    if (source === "journal_size_limit") return [{ journal_size_limit: 67108864 }];
    if (source === "temp_store") return [{ temp_store: 2 }];
    if (source === "query_only") return [{ query_only: 0 }];
    return [];
  }

  exec(sql: string): void {
    this.execs.push(sql);
  }

  prepare(): SqliteBackend {
    throw new Error("prepare is not used by this fake");
  }

  function(name: string, options: { deterministic?: boolean }): void {
    this.functions.push(`${name}:${String(options.deterministic === true)}`);
  }

  close(): void {
    this.open = false;
  }
}
