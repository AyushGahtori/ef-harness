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

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL");
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

  close(): void {
    this.db.close();
  }
}