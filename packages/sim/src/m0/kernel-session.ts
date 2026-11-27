import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  CasBlobStore,
  GlobalBrokerDb,
  bindCoordinatorWriteQueue,
  bindOutbox,
  createNodeSqliteBackend,
  openDatabase,
  openProjectStateDb,
} from "@ef-harness/db";
import type {
  CoordinatorWriteQueue,
  OutboxRepo,
  ProjectStateDb,
  SqliteConnection,
  StateDbLogger,
} from "@ef-harness/db";
import { CrashSignal, type CrashFaultInjector } from "./faults.js";
import {
  allNamed,
  asNumber,
  asString,
  querySql,
  runNamed,
  type SqlCell,
  type SqlParam,
  type SqlRow,
} from "./schema-cache.js";

export interface DbHandle {
  id: string;
  role: "state" | "global";
  db: SimDatabase;
  file: string;
  state: ProjectStateDb | null;
  broker: GlobalBrokerDb | null;
  queue: CoordinatorWriteQueue | null;
  outbox: OutboxRepo | null;
  cas: CasBlobStore | null;
}

export class ReserveRefused extends Error {
  constructor() {
    super("reserve refused");
    this.name = "ReserveRefused";
  }
}

const quietState: StateDbLogger = {
  info() {
    return undefined;
  },
  warn() {
    return undefined;
  },
  error() {
    return undefined;
  },
};

/**
 * state.db and global.db for one simulated run, opened through ProjectStateDb and GlobalBrokerDb.
 */
export class KernelSession {
  readonly projects: DbHandle[] = [];
  readonly global: DbHandle;
  readonly latenciesMs: number[] = [];
  readonly mode: "memory" | "disk";
  private readonly injector: CrashFaultInjector;
  private readonly root: string;
  private readonly now: () => number;
  private readonly statements = new Map<string, SimStatement>();

  constructor(options: {
    mode: "memory" | "disk";
    projectIds: readonly string[];
    diskRoot: string;
    injector: CrashFaultInjector;
    now: () => number;
  }) {
    this.mode = options.mode;
    this.injector = options.injector;
    this.root = options.diskRoot;
    this.now = options.now;
    for (const id of options.projectIds) {
      this.projects.push(this.openState(id));
    }
    this.global = this.openGlobal();
  }

  get casStore(): CasBlobStore {
    const store = this.global.cas;
    if (!store) throw new Error("global CAS is not open");
    return store;
  }

  queue(handle: DbHandle): CoordinatorWriteQueue {
    if (!handle.queue) throw new Error(`project ${handle.id} has no write queue`);
    return handle.queue;
  }

  outbox(handle: DbHandle): OutboxRepo {
    if (!handle.outbox) throw new Error(`project ${handle.id} has no outbox`);
    return handle.outbox;
  }

  private openState(id: string): DbHandle {
    const handle = emptyHandle(id, "state");
    this.attachState(handle, id);
    return handle;
  }

  private openGlobal(): DbHandle {
    const handle = emptyHandle("global", "global");
    this.attachGlobal(handle);
    return handle;
  }

  private attachState(handle: DbHandle, id: string): void {
    const databasePath = path.join(this.root, "projects", id, "state.db");
    if (!fs.existsSync(databasePath)) {
      fs.mkdirSync(path.dirname(databasePath), { recursive: true });
      fs.copyFileSync(templateFiles(this.now).stateFile, databasePath);
    }
    const state = openProjectStateDb({
      projectId: id,
      rootDir: this.root,
      now: this.now,
      logger: quietState,
    });
    handle.state = state;
    handle.broker = null;
    handle.file = state.databasePath;
    handle.queue = bindCoordinatorWriteQueue(state, { now: this.now });
    handle.outbox = bindOutbox(state, { now: this.now });
    handle.cas = null;
    handle.db = new SimConnection(state.writer, () => {
      state.close();
    });
  }

  private attachGlobal(handle: DbHandle): void {
    const databasePath = path.join(this.root, "global.db");
    if (!fs.existsSync(databasePath)) {
      fs.mkdirSync(this.root, { recursive: true });
      fs.copyFileSync(templateFiles(this.now).globalFile, databasePath);
    }
    const broker = GlobalBrokerDb.open({
      root: this.root,
      now: this.now,
      logger: {
        warn() {
          return undefined;
        },
      },
    });
    handle.broker = broker;
    handle.state = null;
    handle.file = broker.filePath;
    handle.queue = null;
    handle.outbox = null;
    handle.cas = new CasBlobStore({
      globalDb: broker.writer as unknown as DatabaseSync,
      rootDir: path.join(this.root, "cas"),
      now: this.now,
      sleep: waitTurn,
    });
    handle.db = new SimConnection(broker.writer, () => {
      broker.close();
    });
  }

  handles(): DbHandle[] {
    return [...this.projects, this.global];
  }

  project(id: string): DbHandle {
    const found = this.projects.find((item) => item.id === id);
    if (!found) throw new Error(`missing project ${id}`);
    return found;
  }

  tx(handle: DbHandle, fn: () => void): void {
    this.runTransaction(handle, fn, true);
  }

  txRaw(handle: DbHandle, fn: () => void): void {
    this.runTransaction(handle, fn, false);
  }

  private runTransaction(handle: DbHandle, fn: () => void, hooked: boolean): void {
    if (hooked) this.injector.hit("before_begin_immediate");
    const started = globalThis.performance.now();
    handle.db.exec("BEGIN IMMEDIATE");
    try {
      fn();
      if (hooked && this.injector.consume("after_write_before_commit")) {
        handle.db.close();
        throw new CrashSignal("after_write_before_commit");
      }
      handle.db.exec("COMMIT");
      this.latenciesMs.push(globalThis.performance.now() - started);
    } catch (error) {
      if (!(error instanceof CrashSignal && error.point === "after_write_before_commit")) {
        if (handle.db.isOpen && handle.db.isTransaction) handle.db.exec("ROLLBACK");
      }
      throw error;
    }
  }

  reopenAll(): void {
    for (const handle of this.handles()) this.reopen(handle);
  }

  private reopen(handle: DbHandle): void {
    if (handle.db.isOpen) {
      if (handle.db.isTransaction) {
        try {
          handle.db.exec("ROLLBACK");
        } catch (error) {
          if (!(error instanceof Error)) throw error;
        }
      }
      if (handle.db.isOpen) handle.db.close();
    }
    this.statements.clear();
    if (handle.role === "state") this.attachState(handle, handle.id);
    else this.attachGlobal(handle);
  }

  all(handle: DbHandle, name: string, params: Record<string, SqlParam> = {}): SqlRow[] {
    return allNamed(this.statement(handle, querySql(name)), params);
  }

  run(handle: DbHandle, name: string, params: Record<string, SqlParam> = {}): number {
    return runNamed(this.statement(handle, querySql(name)), params);
  }

  rows(handle: DbHandle, sql: string, ...params: SqlParam[]): SqlRow[] {
    return this.statement(handle, sql).all(...params);
  }

  row(handle: DbHandle, sql: string, ...params: SqlParam[]): SqlRow | undefined {
    return this.statement(handle, sql).get(...params);
  }

  exec(handle: DbHandle, sql: string, ...params: SqlParam[]): number {
    return this.statement(handle, sql).run(...params).changes;
  }

  private statement(handle: DbHandle, sql: string): SimStatement {
    const key = `${handle.id}\u0000${sql}`;
    const cached = this.statements.get(key);
    if (cached) return cached;
    const prepared = handle.db.prepare(sql);
    this.statements.set(key, prepared);
    return prepared;
  }

  /**
   * A second connection from the db driver must not see the uncommitted write,
   * and must not take the immediate lock while this writer holds it.
   */
  proveDiskIsolation(handle: DbHandle): { walIsolated: boolean; fileLocked: boolean } {
    if (this.mode !== "disk") return { walIsolated: true, fileLocked: true };
    const reader = openDatabase({ location: handle.file, role: "state", access: "readonly" });
    const other = openDatabase({
      location: handle.file,
      role: "state",
      access: "writer",
      backend: (options) => createNodeSqliteBackend({ ...options, timeoutMs: 0 }),
    });
    other.exec("PRAGMA busy_timeout = 0");
    try {
      const before = readEpoch(reader);
      handle.db.exec("BEGIN IMMEDIATE");
      handle.db.prepare("UPDATE meta SET value = 'wal-probe' WHERE key = 'stream_epoch'").run();
      const during = readEpoch(reader);
      let fileLocked = false;
      try {
        other.exec("BEGIN IMMEDIATE");
        if (other.inTransaction) other.exec("ROLLBACK");
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        fileLocked = true;
      }
      handle.db.exec("ROLLBACK");
      const after = readEpoch(reader);
      return {
        walIsolated: during === before && after === before && before !== "wal-probe",
        fileLocked,
      };
    } finally {
      if (handle.db.isOpen && handle.db.isTransaction) handle.db.exec("ROLLBACK");
      reader.close();
      other.close();
    }
  }

  close(): void {
    for (const handle of this.handles()) {
      if (handle.db.isOpen) handle.db.close();
    }
  }
}

export interface SimDatabase {
  readonly isOpen: boolean;
  readonly isTransaction: boolean;
  exec(sql: string): void;
  prepare(sql: string): SimStatement;
  close(): void;
}

export interface SimStatement {
  run(...params: readonly unknown[]): { changes: number };
  get(...params: readonly unknown[]): SqlRow | undefined;
  all(...params: readonly unknown[]): SqlRow[];
}

class SimConnection implements SimDatabase {
  private openFlag = true;

  constructor(
    private readonly writer: SqliteConnection,
    private readonly release: () => void,
  ) {}

  get isOpen(): boolean {
    return this.openFlag && this.writer.open;
  }

  get isTransaction(): boolean {
    return this.isOpen && this.writer.inTransaction;
  }

  exec(sql: string): void {
    this.writer.exec(sql);
  }

  prepare(sql: string): SimStatement {
    const statement = this.writer.prepare(sql);
    return {
      run: (...params: readonly unknown[]) => {
        const result = statement.run(bindArgs(params));
        return { changes: result.changes };
      },
      get: (...params: readonly unknown[]) => asRow(statement.get(params.map((value) => asParam(value)))),
      all: (...params: readonly unknown[]) => {
        const rows = statement.all(bindArgs(params));
        return rows.map((row) => {
          const parsed = asRow(row);
          if (!parsed) throw new Error("SQLite row was not an object");
          return parsed;
        });
      },
    };
  }

  close(): void {
    if (!this.openFlag) return;
    this.openFlag = false;
    this.release();
  }
}

function emptyHandle(id: string, role: "state" | "global"): DbHandle {
  const placeholder = new SimConnection(closedWriter(), () => undefined);
  placeholder.close();
  return {
    id,
    role,
    db: placeholder,
    file: "",
    state: null,
    broker: null,
    queue: null,
    outbox: null,
    cas: null,
  };
}

function closedWriter(): SqliteConnection {
  return {
    location: "",
    role: "state",
    access: "writer",
    open: false,
    inTransaction: false,
    inImmediateTransaction: false,
    exec() {
      throw new Error("connection is closed");
    },
    prepare() {
      throw new Error("connection is closed");
    },
    get() {
      throw new Error("connection is closed");
    },
    all() {
      throw new Error("connection is closed");
    },
    run() {
      throw new Error("connection is closed");
    },
    pragma() {
      throw new Error("connection is closed");
    },
    registerFunction() {
      throw new Error("connection is closed");
    },
    transaction() {
      throw new Error("connection is closed");
    },
    savepoint() {
      throw new Error("connection is closed");
    },
    addWriteListener() {
      return () => undefined;
    },
    attachCheckpointScheduler() {
      return undefined;
    },
    close() {
      return undefined;
    },
  };
}

function bindArgs(params: readonly unknown[]): Record<string, SqlParam> | readonly SqlParam[] | undefined {
  if (params.length === 0) return undefined;
  const first = params[0];
  if (params.length === 1 && isParamRecord(first)) return first;
  return params.map((value) => asParam(value));
}

function isParamRecord(value: unknown): value is Record<string, SqlParam> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || value instanceof Uint8Array) {
    return false;
  }
  return true;
}

function asParam(value: unknown): SqlParam {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    return value;
  }
  if (value instanceof Uint8Array) return value;
  throw new Error("SQLite parameter is not a supported value");
}

function asRow(value: unknown): SqlRow | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("SQLite row was not an object");
  }
  const row: SqlRow = {};
  for (const key of Object.keys(value)) {
    row[key] = asCell(Reflect.get(value, key), key);
  }
  return row;
}

function asCell(value: unknown, key: string): SqlCell {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") return value;
  if (value instanceof Uint8Array) return value;
  throw new Error(`SQLite cell ${key} is not a supported value`);
}

function readEpoch(connection: SqliteConnection): string {
  const row = asRow(connection.get("SELECT value FROM meta WHERE key = 'stream_epoch'"));
  return asString(row?.value, "stream_epoch");
}

let cachedTemplates: { stateFile: string; globalFile: string } | undefined;

function templateFiles(now: () => number): { stateFile: string; globalFile: string } {
  if (cachedTemplates) return cachedTemplates;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ef-m0-template-"));
  const state = openProjectStateDb({
    projectId: "m0template",
    rootDir: root,
    now,
    logger: quietState,
  });
  const stateFile = state.databasePath;
  state.close();
  const broker = GlobalBrokerDb.open({
    root,
    now,
    logger: {
      warn() {
        return undefined;
      },
    },
  });
  const globalFile = broker.filePath;
  broker.close();
  cachedTemplates = { stateFile, globalFile };
  return cachedTemplates;
}

function waitTurn(): Promise<void> {
  return Promise.resolve();
}

export function numberCell(row: SqlRow | undefined, key: string): number {
  if (!row) throw new Error(`missing ${key}`);
  return asNumber(row[key], key);
}

export function stringCell(row: SqlRow | undefined, key: string): string {
  if (!row) throw new Error(`missing ${key}`);
  return asString(row[key], key);
}
