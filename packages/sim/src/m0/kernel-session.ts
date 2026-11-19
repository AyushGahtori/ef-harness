import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { CrashSignal, type CrashFaultInjector } from "./faults.js";
import {
  allNamed,
  applyMemoryPragmas,
  asNumber,
  asString,
  emptyGlobalTemplate,
  emptyStateTemplate,
  globalSchemaSql,
  openDisk,
  openMemory,
  querySql,
  registerSearch,
  reopenDisk,
  runNamed,
  stateSchemaSql,
  type SqlRow,
} from "./schema-cache.js";

export interface DbHandle {
  id: string;
  role: "state" | "global";
  db: DatabaseSync;
  snap: Uint8Array | null;
  file: string | null;
}

export class ReserveRefused extends Error {
  constructor() {
    super("reserve refused");
    this.name = "ReserveRefused";
  }
}

/**
 * Owns the state.db and global.db connections for one simulated run.
 * Memory runs clone a schema image. Disk runs use WAL files.
 */
export class KernelSession {
  readonly projects: DbHandle[] = [];
  readonly global: DbHandle;
  readonly latenciesMs: number[] = [];
  readonly mode: "memory" | "disk";
  private readonly injector: CrashFaultInjector;
  private readonly statements = new Map<string, StatementSync>();

  constructor(options: {
    mode: "memory" | "disk";
    projectIds: readonly string[];
    diskRoot: string | null;
    injector: CrashFaultInjector;
  }) {
    this.mode = options.mode;
    this.injector = options.injector;
    if (options.mode === "disk" && options.diskRoot) {
      fs.mkdirSync(options.diskRoot, { recursive: true });
    }
    for (const id of options.projectIds) {
      this.projects.push(this.openState(id, options.diskRoot));
    }
    this.global = this.openGlobal(options.diskRoot);
  }

  private openState(id: string, diskRoot: string | null): DbHandle {
    if (this.mode === "memory") {
      const db = openMemory(emptyStateTemplate(), true);
      return { id, role: "state", db, snap: emptyStateTemplate(), file: null };
    }
    const file = path.join(diskRoot ?? "", `${id}-state.db`);
    const db = openDisk(file, true, stateSchemaSql());
    return { id, role: "state", db, snap: null, file };
  }

  private openGlobal(diskRoot: string | null): DbHandle {
    if (this.mode === "memory") {
      const db = openMemory(emptyGlobalTemplate(), false);
      return { id: "global", role: "global", db, snap: emptyGlobalTemplate(), file: null };
    }
    const file = path.join(diskRoot ?? "", "global.db");
    const db = openDisk(file, false, globalSchemaSql());
    return { id: "global", role: "global", db, snap: null, file };
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
    if (this.mode === "memory") handle.snap = handle.db.serialize();
  }

  reopenAll(): void {
    for (const handle of this.handles()) this.reopen(handle);
  }

  private reopen(handle: DbHandle): void {
    if (handle.db.isOpen) {
      if (handle.db.isTransaction) {
        try {
          handle.db.exec("ROLLBACK");
        } catch {
          // The connection was closed underneath the transaction.
        }
      }
      if (handle.db.isOpen) handle.db.close();
    }
    this.statements.clear();
    if (this.mode === "memory") {
      if (!handle.snap) throw new Error(`missing memory snapshot for ${handle.id}`);
      const db = new DatabaseSync(":memory:");
      applyMemoryPragmas(db);
      if (handle.role === "state") registerSearch(db);
      db.deserialize(handle.snap);
      applyMemoryPragmas(db);
      if (handle.role === "state") registerSearch(db);
      handle.db = db;
      return;
    }
    if (!handle.file) throw new Error(`missing disk file for ${handle.id}`);
    handle.db = reopenDisk(handle.file, handle.role === "state");
  }

  all(handle: DbHandle, name: string, params: Record<string, SQLInputValue> = {}): SqlRow[] {
    return allNamed(this.statement(handle, querySql(name)), params);
  }

  run(handle: DbHandle, name: string, params: Record<string, SQLInputValue> = {}): number {
    return runNamed(this.statement(handle, querySql(name)), params);
  }

  rows(handle: DbHandle, sql: string, ...params: SQLInputValue[]): SqlRow[] {
    return this.statement(handle, sql).all(...params) as SqlRow[];
  }

  row(handle: DbHandle, sql: string, ...params: SQLInputValue[]): SqlRow | undefined {
    return this.statement(handle, sql).get(...params) as SqlRow | undefined;
  }

  exec(handle: DbHandle, sql: string, ...params: SQLInputValue[]): number {
    return Number(this.statement(handle, sql).run(...params).changes);
  }

  private statement(handle: DbHandle, sql: string): StatementSync {
    const key = `${handle.id}\u0000${sql}`;
    const cached = this.statements.get(key);
    if (cached) return cached;
    const prepared = handle.db.prepare(sql);
    this.statements.set(key, prepared);
    return prepared;
  }

  /**
   * Disk runs prove WAL readers cannot see an uncommitted write and a second
   * writer cannot take the immediate lock. The probe is rolled back.
   */
  proveDiskIsolation(handle: DbHandle): { walIsolated: boolean; fileLocked: boolean } {
    if (this.mode !== "disk" || !handle.file) return { walIsolated: true, fileLocked: true };
    const reader = new DatabaseSync(handle.file, { readOnly: true, timeout: 1000 });
    const other = new DatabaseSync(handle.file, { timeout: 0 });
    try {
      reader.exec("PRAGMA foreign_keys = ON");
      const beforeRow = reader.prepare("SELECT value FROM meta WHERE key = 'stream_epoch'").get() as SqlRow | undefined;
      const before = asString(beforeRow?.value, "stream_epoch");
      handle.db.exec("BEGIN IMMEDIATE");
      handle.db.prepare("UPDATE meta SET value = 'wal-probe' WHERE key = 'stream_epoch'").run();
      const duringRow = reader.prepare("SELECT value FROM meta WHERE key = 'stream_epoch'").get() as SqlRow | undefined;
      const during = asString(duringRow?.value, "stream_epoch");
      let fileLocked = false;
      try {
        other.exec("BEGIN IMMEDIATE");
        if (other.isTransaction) other.exec("ROLLBACK");
      } catch {
        fileLocked = true;
      }
      handle.db.exec("ROLLBACK");
      const afterRow = reader.prepare("SELECT value FROM meta WHERE key = 'stream_epoch'").get() as SqlRow | undefined;
      const after = asString(afterRow?.value, "stream_epoch");
      return { walIsolated: during === before && after === before && before !== "wal-probe", fileLocked };
    } finally {
      if (handle.db.isOpen && handle.db.isTransaction) handle.db.exec("ROLLBACK");
      reader.close();
      if (other.isOpen) other.close();
    }
  }

  close(): void {
    for (const handle of this.handles()) {
      if (handle.db.isOpen) handle.db.close();
    }
  }
}

export function numberCell(row: SqlRow | undefined, key: string): number {
  if (!row) throw new Error(`missing ${key}`);
  return asNumber(row[key], key);
}

export function stringCell(row: SqlRow | undefined, key: string): string {
  if (!row) throw new Error(`missing ${key}`);
  return asString(row[key], key);
}
