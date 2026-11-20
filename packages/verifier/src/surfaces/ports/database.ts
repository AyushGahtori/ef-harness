import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { DatabaseSync, type SQLInputValue, type SQLOutputValue } from "node:sqlite";

/**
 * Local database port.
 * SQLite uses `node:sqlite` on a fresh Tier 3 temp file.
 * Postgres uses the same isolated file only as a storage stand-in for the
 * postgres-compatible SQL subset, and it always records `SET statement_timeout`.
 * It refuses SQLite-only SQL. Swap the postgres opener for Task 050
 * `EmbeddedPostgresProvider` when that package is wired.
 */

export type EngineDialect = "sqlite" | "postgres";

export interface ApplyOutcome {
  readonly ok: boolean;
  readonly timedOut: boolean;
  readonly message?: string;
  readonly statements: readonly string[];
}

export interface IntegrityReport {
  readonly integrityOk: boolean;
  readonly foreignKeyViolations: number;
  readonly indexes: readonly string[];
}

export interface MigrationSession {
  readonly dialect: EngineDialect;
  readonly tier: 3;
  exec(sql: string): void;
  query(sql: string): Record<string, unknown>[];
  insert(
    table: string,
    columns: readonly string[],
    rows: readonly Record<string, string | number | null>[],
  ): void;
  listIndexes(table: string): string[];
  validateIntegrity(): IntegrityReport;
  apply(sql: string, statementTimeoutMs: number): Promise<ApplyOutcome>;
  close(): Promise<void>;
}

export interface DatabaseEnginePort {
  open(options: { readonly dialect: EngineDialect }): Promise<MigrationSession>;
}

const WORKER_SOURCE = `
import { parentPort, workerData } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(workerData.file);
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA busy_timeout = " + Number(workerData.statementTimeoutMs));
db.function("ef_sleep_ms", (ms) => {
  const duration = Number(ms);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, duration);
  return duration;
});
try {
  db.exec(workerData.sql);
  parentPort.postMessage({ ok: true });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    message: error instanceof Error ? error.message : String(error),
  });
} finally {
  db.close();
}
`;

function quoteIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`unsafe identifier ${name}`);
  }
  return `"${name}"`;
}

function asCell(value: SQLOutputValue): unknown {
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Uint8Array) return Buffer.from(value).toString("utf8");
  return value;
}

function rowsOf(rows: readonly Record<string, SQLOutputValue>[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const copy: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) copy[key] = asCell(value);
    return copy;
  });
}

async function runWorker(file: string, sql: string, statementTimeoutMs: number): Promise<{
  ok: boolean;
  timedOut: boolean;
  message?: string;
}> {
  const worker = new Worker(WORKER_SOURCE, {
    eval: true,
    execArgv: ["--input-type=module"],
    workerData: { file, sql, statementTimeoutMs },
  });
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (outcome: { ok: boolean; timedOut: boolean; message?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    const timer = setTimeout(() => {
      void worker.terminate().finally(() => {
        finish({ ok: false, timedOut: true, message: `statement_timeout ${statementTimeoutMs}ms` });
      });
    }, statementTimeoutMs);
    worker.on("message", (message: { ok?: boolean; message?: string }) => {
      finish({
        ok: message.ok === true,
        timedOut: false,
        ...(message.message !== undefined ? { message: message.message } : {}),
      });
    });
    worker.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

class FileMigrationSession implements MigrationSession {
  readonly tier = 3 as const;
  private db: DatabaseSync | null;

  constructor(
    readonly dialect: EngineDialect,
    private readonly file: string,
    private readonly directory: string,
  ) {
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA busy_timeout = 2000");
  }

  private connection(): DatabaseSync {
    if (!this.db) throw new Error("migration session is closed");
    return this.db;
  }

  exec(sql: string): void {
    this.connection().exec(sql);
  }

  query(sql: string): Record<string, unknown>[] {
    return rowsOf(this.connection().prepare(sql).all());
  }

  insert(
    table: string,
    columns: readonly string[],
    rows: readonly Record<string, string | number | null>[],
  ): void {
    const sql = `INSERT INTO ${quoteIdent(table)} (${columns.map(quoteIdent).join(", ")}) VALUES (${columns
      .map(() => "?")
      .join(", ")})`;
    const statement = this.connection().prepare(sql);
    for (const row of rows) {
      const values: SQLInputValue[] = columns.map((column) => row[column] ?? null);
      statement.run(...values);
    }
  }

  listIndexes(table: string): string[] {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
      throw new Error(`unsafe table ${table}`);
    }
    const rows = this.query(`PRAGMA index_list(${table})`);
    return rows.map((row) => String(row.name));
  }

  validateIntegrity(): IntegrityReport {
    const integrity = this.query("PRAGMA integrity_check");
    const foreignKeys = this.query("PRAGMA foreign_key_check");
    const integrityOk = integrity.length === 1 && integrity[0]?.integrity_check === "ok";
    return {
      integrityOk,
      foreignKeyViolations: foreignKeys.length,
      indexes: [],
    };
  }

  async apply(sql: string, statementTimeoutMs: number): Promise<ApplyOutcome> {
    if (this.dialect === "postgres" && (/\bPRAGMA\b/i.test(sql) || /\bAUTOINCREMENT\b/i.test(sql))) {
      return {
        ok: false,
        timedOut: false,
        message: "sqlite-specific SQL refused on the postgres engine",
        statements: [`SET statement_timeout = '${statementTimeoutMs}ms'`, sql],
      };
    }
    this.connection().close();
    this.db = null;
    const outcome = await runWorker(this.file, sql, statementTimeoutMs);
    this.db = new DatabaseSync(this.file);
    this.db.exec("PRAGMA foreign_keys = ON");
    const statements =
      this.dialect === "postgres" ? [`SET statement_timeout = '${statementTimeoutMs}ms'`, sql] : [sql];
    return { ...outcome, statements };
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = null;
    await rm(this.directory, { recursive: true, force: true });
  }
}

async function openFile(dialect: EngineDialect): Promise<MigrationSession> {
  const directory = await mkdtemp(path.join(tmpdir(), `ef-tier3-${dialect}-`));
  const file = path.join(directory, "migration.sqlite");
  return new FileMigrationSession(dialect, file, directory);
}

export function createDefaultDatabaseEngine(): DatabaseEnginePort {
  return {
    open(options) {
      return openFile(options.dialect);
    },
  };
}

export async function openTier3Database(dialect: EngineDialect): Promise<MigrationSession> {
  return openFile(dialect);
}
