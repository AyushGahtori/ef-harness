import { Worker } from "node:worker_threads";
import { AttachedDatabaseForbiddenError, ReaderBudgetError, ReaderTimeoutError } from "./errors.js";
import { splitSearchText } from "./search-text.js";
import { bindParameters, inspectSql, isMemoryLocation } from "./sql.js";
import type { SqlParams } from "./values.js";
import type { DatabaseRole } from "./types.js";

export type ReaderQueryClass = "ui" | "export";

export const READER_TIMEOUT_LIMITS = {
  ui: 200,
  export: 2_000,
} as const;

export interface ReaderQuery {
  readonly sql: string;
  readonly params?: SqlParams;
  readonly class: ReaderQueryClass;
  readonly timeoutMs: number;
}

export interface WorkerReaderPoolOptions {
  readonly location: string;
  readonly role: DatabaseRole;
  readonly size?: number;
  readonly lazy?: boolean;
}

export type ReaderPoolOptions = WorkerReaderPoolOptions;

interface WorkerSlot {
  worker: Worker;
  busy: boolean;
  dead: boolean;
}

interface WorkerResponse {
  readonly id?: number;
  readonly type?: string;
  readonly ok?: boolean;
  readonly rows?: unknown[];
  readonly timeout?: boolean;
  readonly message?: string;
}

const WORKER_SOURCE = [
  '"use strict";',
  'const { parentPort, workerData } = require("node:worker_threads");',
  'const { DatabaseSync } = require("node:sqlite");',
  "function fallbackSplit(value) {",
  '  if (!value) return "";',
  '  const original = typeof value === "string" ? value : String(value);',
  "  const extra = original",
  '    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")',
  '    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")',
  '    .replace(/[_\\-./:]+/g, " ");',
  '  return original + " " + extra;',
  "}",
  "function resolveSplit() {",
  '  if (typeof workerData.searchSource !== "string") return fallbackSplit;',
  "  try {",
  '    const compiled = Function("\\"use strict\\"; return (" + workerData.searchSource + ");")();',
  '    return typeof compiled === "function" ? compiled : fallbackSplit;',
  "  } catch (compileError) {",
  "    return fallbackSplit;",
  "  }",
  "}",
  "function sleep(ms) {",
  "  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);",
  "}",
  "function openDatabase() {",
  "  const delays = [0, 20, 50, 100, 200, 400, 800];",
  "  let last;",
  "  for (const delay of delays) {",
  "    if (delay > 0) sleep(delay);",
  "    try {",
  "      return new DatabaseSync(workerData.location, {",
  "        readOnly: true,",
  "        timeout: 0,",
  "        readBigInts: true,",
  "        defensive: true,",
  "        limits: { attach: 0 },",
  "      });",
  "    } catch (error) {",
  "      last = error;",
  '      const message = error && error.message ? String(error.message) : "";',
  "      if (!/busy|locked|perm|access/i.test(message)) throw error;",
  "    }",
  "  }",
  "  throw last;",
  "}",
  "function normalize(value) {",
  '  if (typeof value === "bigint") {',
  "    const max = BigInt(Number.MAX_SAFE_INTEGER);",
  "    const min = BigInt(Number.MIN_SAFE_INTEGER);",
  "    return value <= max && value >= min ? Number(value) : value;",
  "  }",
  "  if (Array.isArray(value)) return value.map(normalize);",
  '  if (value && typeof value === "object" && !(value instanceof Uint8Array)) {',
  "    const plain = {};",
  "    for (const key of Object.keys(value)) plain[key] = normalize(value[key]);",
  "    return plain;",
  "  }",
  "  return value;",
  "}",
  "function bind(statement, params) {",
  "  if (params == null) return statement.iterate();",
  "  if (Array.isArray(params)) return statement.iterate(...params);",
  "  return statement.iterate(params);",
  "}",
  "let db;",
  "try {",
  "  db = openDatabase();",
  '  db.exec("PRAGMA query_only = ON");',
  '  db.exec("PRAGMA foreign_keys = ON");',
  '  if (workerData.role === "state") {',
  "    const splitSearchText = resolveSplit();",
  '    db.function("ef_search_text", { deterministic: true }, (value) => splitSearchText(value));',
  "  }",
  '  parentPort.postMessage({ type: "ready" });',
  "} catch (initError) {",
  "  try { if (db && db.isOpen) db.close(); } catch (closeError) { void closeError; }",
  '  parentPort.postMessage({ type: "fatal", message: initError && initError.message ? String(initError.message) : String(initError) });',
  "  process.exit(1);",
  "}",
  'parentPort.on("message", (message) => {',
  '  if (!message || message.type === "close") {',
  "    try { db.close(); } catch (closeError) { void closeError; }",
  "    process.exit(0);",
  "  }",
  '  if (message.type !== "query") return;',
  "  const deadline = performance.now() + Number(message.timeoutMs);",
  "  let failed = null;",
  "  let rows = [];",
  "  try {",
  '    db.exec("BEGIN");',
  "    const statement = db.prepare(message.sql);",
  "    statement.setReadBigInts(true);",
  "    const iterator = bind(statement, message.params);",
  "    for (const row of iterator) {",
  "      if (performance.now() >= deadline) {",
  '        if (typeof iterator.return === "function") iterator.return();',
  '        const timeout = new Error("reader time budget exceeded");',
  '        timeout.code = "READER_TIMEOUT";',
  "        throw timeout;",
  "      }",
  "      rows.push(normalize(row));",
  "    }",
  "    const dispose = statement[Symbol.dispose];",
  '    if (typeof dispose === "function") dispose.call(statement);',
  "  } catch (error) {",
  "    failed = error;",
  "    rows = [];",
  "  } finally {",
  "    try {",
  '      if (db.isTransaction) db.exec("ROLLBACK");',
  "    } catch (rollbackError) {",
  "      if (!failed) failed = rollbackError;",
  "    }",
  "  }",
  "  if (failed) {",
  "    parentPort.postMessage({",
  "      id: message.id,",
  "      ok: false,",
  '      timeout: failed.code === "READER_TIMEOUT",',
  "      message: failed.message ? String(failed.message) : String(failed),",
  "      code: failed.code,",
  "      errcode: failed.errcode,",
  "    });",
  "    return;",
  "  }",
  "  parentPort.postMessage({ id: message.id, ok: true, rows });",
  "});",
  "",
].join("\n");

export class WorkerReaderPool {
  readonly #location: string;
  readonly #role: DatabaseRole;
  readonly #size: number;
  readonly #searchSource: string;
  #slots: WorkerSlot[] = [];
  #waiters: Array<(slot: WorkerSlot) => void> = [];
  #nextId = 0;
  #closed = false;
  #opening: Promise<void> | undefined;

  constructor(options: WorkerReaderPoolOptions) {
    if (isMemoryLocation(options.location)) {
      throw new ReaderBudgetError("WorkerReaderPool requires a file-backed database so each worker can open its own connection.");
    }
    this.#location = options.location;
    this.#role = options.role;
    this.#searchSource = splitSearchText.toString();
    const size = options.size ?? 2;
    if (!Number.isInteger(size) || size < 1) {
      throw new ReaderBudgetError("WorkerReaderPool size must be a positive integer.");
    }
    this.#size = size;
    if (!options.lazy) {
      this.warmup().catch(() => undefined);
    }
  }

  get location(): string {
    return this.#location;
  }

  get role(): DatabaseRole {
    return this.#role;
  }

  get closed(): boolean {
    return this.#closed;
  }

  warmup(): Promise<void> {
    if (this.#closed) {
      return Promise.reject(new ReaderBudgetError("WorkerReaderPool is closed."));
    }
    if (this.#opening === undefined) {
      this.#opening = Promise.all(Array.from({ length: this.#size }, () => this.#spawn())).then((slots) => {
        this.#slots = slots;
      });
    }
    return this.#opening;
  }

  async query(input: ReaderQuery): Promise<unknown[]> {
    assertBudget(input);
    if (inspectSql(input.sql).attach) throw new AttachedDatabaseForbiddenError();
    const params = bindParameters(input.sql, input.params);
    if (this.#closed) throw new ReaderBudgetError("WorkerReaderPool is closed.");
    await this.warmup();
    if (this.#closed) throw new ReaderBudgetError("WorkerReaderPool is closed.");
    const slot = await this.#acquire();
    const id = this.#nextId + 1;
    this.#nextId = id;
    const pending = waitForResponse(slot, id, input.timeoutMs);
    slot.worker.postMessage({
      type: "query",
      id,
      sql: input.sql,
      params: params ?? null,
      timeoutMs: input.timeoutMs,
    });
    try {
      const response = await pending;
      if (response.timeout) {
        this.#recycle(slot);
        throw new ReaderTimeoutError(input.timeoutMs, input.class);
      }
      if (response.ok !== true) {
        this.#release(slot);
        throw new Error(response.message ?? "Reader query failed.");
      }
      this.#release(slot);
      return response.rows ?? [];
    } catch (error) {
      if (error instanceof ReaderTimeoutError) throw error;
      if (isParentTimeout(error)) {
        this.#recycle(slot);
        throw new ReaderTimeoutError(input.timeoutMs, input.class);
      }
      this.#recycle(slot);
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#opening !== undefined) {
      try {
        await this.#opening;
      } catch (openError: unknown) {
        const message = openError instanceof Error ? openError.message : "";
        void message;
      }
    }
    const workers = this.#slots.map((slot) => slot.worker);
    for (const slot of this.#slots) slot.dead = true;
    for (const worker of workers) {
      try {
        worker.postMessage({ type: "close" });
      } catch (postError: unknown) {
        const message = postError instanceof Error ? postError.message : "";
        void message;
      }
    }
    await Promise.all(
      workers.map(async (worker) => {
        const exited = onceExit(worker);
        const timedOut = sleep(500).then(() => worker.terminate());
        await Promise.race([exited, timedOut]);
      }),
    );
  }

  drainAndClose(_timeoutMs?: number): Promise<void> {
    void _timeoutMs;
    return this.close();
  }

  #spawn(): Promise<WorkerSlot> {
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: {
        location: this.#location,
        role: this.#role,
        searchSource: this.#searchSource,
      },
    });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Reader worker did not open the database."));
      }, 5_000);
      const onMessage = (message: WorkerResponse) => {
        if (message.type === "ready") {
          cleanup();
          resolve({ worker, busy: false, dead: false });
        }
        if (message.type === "fatal") {
          cleanup();
          reject(new Error(message.message ?? "Reader worker failed to open."));
        }
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const cleanup = () => {
        clearTimeout(timer);
        worker.off("message", onMessage);
        worker.off("error", onError);
      };
      worker.on("message", onMessage);
      worker.on("error", onError);
    });
  }

  async #acquire(): Promise<WorkerSlot> {
    const free = this.#slots.find((slot) => !slot.busy && !slot.dead);
    if (free) {
      free.busy = true;
      return free;
    }
    return new Promise((resolve) => {
      this.#waiters.push(resolve);
    });
  }

  #release(slot: WorkerSlot): void {
    if (slot.dead || this.#closed) return;
    const waiter = this.#waiters.shift();
    if (waiter) {
      slot.busy = true;
      waiter(slot);
      return;
    }
    slot.busy = false;
  }

  #recycle(slot: WorkerSlot): void {
    if (!slot.dead) {
      slot.dead = true;
      slot.busy = false;
      void slot.worker.terminate();
    }
    if (this.#closed) return;
    const replacement = this.#spawn();
    void replacement.then((fresh) => {
      const index = this.#slots.indexOf(slot);
      if (index >= 0) this.#slots[index] = fresh;
      else this.#slots.push(fresh);
      const waiter = this.#waiters.shift();
      if (waiter && !this.#closed) {
        fresh.busy = true;
        waiter(fresh);
      }
    });
  }
}

export { WorkerReaderPool as ReaderPool };

function assertBudget(input: ReaderQuery): void {
  const limit = READER_TIMEOUT_LIMITS[input.class];
  if (limit === undefined) {
    throw new ReaderBudgetError('Reader queries must use class "ui" or "export".');
  }
  if (!Number.isInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > limit) {
    throw new ReaderBudgetError(
      `${input.class} reads require an explicit timeout from 1 to ${limit} ms. Unbounded reads are forbidden.`,
    );
  }
}

function waitForResponse(slot: WorkerSlot, id: number, timeoutMs: number): Promise<WorkerResponse> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(parentTimeout());
    }, timeoutMs + 75);
    const onMessage = (message: WorkerResponse) => {
      if (message.id !== id) return;
      cleanup();
      resolve(message);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onExit = (code: number) => {
      cleanup();
      reject(new Error(`Reader worker exited (${code}) before the query finished.`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      slot.worker.off("message", onMessage);
      slot.worker.off("error", onError);
      slot.worker.off("exit", onExit);
    };
    slot.worker.on("message", onMessage);
    slot.worker.on("error", onError);
    slot.worker.on("exit", onExit);
  });
}

function parentTimeout(): Error {
  const error = new Error("Reader worker missed its time budget.");
  error.name = "ParentReaderTimeout";
  return error;
}

function isParentTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === "ParentReaderTimeout";
}

function onceExit(worker: Worker): Promise<void> {
  return new Promise((resolve) => {
    worker.once("exit", () => resolve());
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
