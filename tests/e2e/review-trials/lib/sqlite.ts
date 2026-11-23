import { DatabaseSync } from "node:sqlite";

export class AttachedDatabaseForbiddenError extends Error {
  constructor() {
    super("ATTACH DATABASE is forbidden across harness database files");
    this.name = "AttachedDatabaseForbiddenError";
  }
}

function containsAttach(sql: string): boolean {
  const stripped = sql.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  return /\battach\b/i.test(stripped);
}

type SqlValue = string | number | null | bigint;

export class PolicyDatabase {
  private readonly db: DatabaseSync;
  private depth = 0;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA foreign_keys = ON");
  }

  exec(sql: string): void {
    if (containsAttach(sql)) throw new AttachedDatabaseForbiddenError();
    this.db.exec(sql);
  }

  run(sql: string, params: readonly SqlValue[] = []): void {
    if (containsAttach(sql)) throw new AttachedDatabaseForbiddenError();
    const stmt = this.db.prepare(sql);
    if (params.length === 0) stmt.run();
    else stmt.run(...params);
  }

  get(sql: string, params: readonly SqlValue[] = []): Record<string, unknown> | undefined {
    if (containsAttach(sql)) throw new AttachedDatabaseForbiddenError();
    const stmt = this.db.prepare(sql);
    const row = params.length === 0 ? stmt.get() : stmt.get(...params);
    if (row === undefined || row === null) return undefined;
    return row as Record<string, unknown>;
  }

  all(sql: string, params: readonly SqlValue[] = []): Record<string, unknown>[] {
    if (containsAttach(sql)) throw new AttachedDatabaseForbiddenError();
    const stmt = this.db.prepare(sql);
    const rows = params.length === 0 ? stmt.all() : stmt.all(...params);
    return rows as Record<string, unknown>[];
  }

  function(name: string, fn: (...args: unknown[]) => unknown): void {
    this.db.function(name, { deterministic: true }, fn);
  }

  beginImmediate(): void {
    if (this.depth !== 0) throw new Error("nested BEGIN IMMEDIATE is forbidden");
    this.exec("BEGIN IMMEDIATE");
    this.depth = 1;
  }

  commit(): void {
    if (this.depth === 0) throw new Error("no transaction");
    this.exec("COMMIT");
    this.depth = 0;
  }

  rollback(): void {
    if (this.depth === 0) return;
    this.exec("ROLLBACK");
    this.depth = 0;
  }

  savepoint<T>(body: () => T): T {
    const name = `sp_${this.depth + 1}`;
    this.exec(`SAVEPOINT ${name}`);
    this.depth += 1;
    try {
      const value = body();
      this.exec(`RELEASE ${name}`);
      this.depth -= 1;
      return value;
    } catch (error) {
      this.exec(`ROLLBACK TO ${name}`);
      this.exec(`RELEASE ${name}`);
      this.depth -= 1;
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }
}

export function namedQuery(queriesSql: string, name: string): string {
  const parts = queriesSql.split(/^-- name: /m).slice(1);
  for (const part of parts) {
    const [title, ...rest] = part.split("\n");
    if (title?.trim() === name) {
      return rest
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim()
        .replace(/;\s*$/, "");
    }
  }
  throw new Error(`missing named query ${name}`);
}
