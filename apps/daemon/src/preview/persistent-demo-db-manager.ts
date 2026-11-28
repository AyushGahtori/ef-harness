import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { previewDatabaseName } from "./preview-partition.js";
import { assertAdditiveSql, assertMigrationIdentity } from "./sql-guard.js";
import type { SqlMigration, TemplateDbSeeder, TestEnvOrchestrator } from "./ports.js";

export interface PersistentDemoDbManagerOptions {
  readonly projectId: string;
  readonly dataDir: string;
  readonly engine: "sqlite" | "postgres";
  readonly templates: TemplateDbSeeder;
  readonly testEnv: TestEnvOrchestrator;
  readonly now?: () => number;
}

interface QueryMessage {
  readonly op?: string;
  readonly sql?: string;
}

function cell(value: SQLOutputValue | undefined): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return null;
}

/**
 * Persistent preview database. Merge updates apply additive migrations only.
 * `Reset Demo Data` is the only path that reclones the functional seed.
 */
export class PersistentDemoDbManager {
  readonly engine: "sqlite" | "postgres";
  private database: DatabaseSync | null = null;
  private endpoint: net.Server | null = null;
  private readonly now: () => number;

  constructor(private readonly options: PersistentDemoDbManagerOptions) {
    this.engine = options.engine;
    this.now = options.now ?? (() => Date.now());
    const template = options.testEnv.ensureTemplate(options.projectId);
    const snapshot = options.templates.snapshotPath(options.projectId);
    const demo = this.databaseFile();
    const resolved = new Set([path.resolve(template), path.resolve(snapshot), path.resolve(demo)]);
    if (resolved.size !== 3) {
      throw new Error("preview demo database must stay separate from automated test template databases");
    }
  }

  databaseName(): string {
    return previewDatabaseName(this.options.projectId, this.engine);
  }

  databaseFile(): string {
    return path.join(this.options.dataDir, "preview", this.databaseName());
  }

  connectionString(dbPort: number | null): string {
    if (this.engine === "sqlite") return `file:${this.databaseFile()}`;
    const port = dbPort ?? 0;
    return `postgres://preview@127.0.0.1:${port}/${this.databaseName()}`;
  }

  ensureSeeded(): void {
    if (!fs.existsSync(this.databaseFile())) {
      this.options.templates.cloneFunctionalSeed(this.options.projectId, this.databaseFile());
    }
    this.open();
  }

  assertCanApply(migrations: readonly SqlMigration[]): void {
    for (const migration of migrations) assertMigrationIdentity(migration);
  }

  applyAdditiveMigrations(migrations: readonly SqlMigration[]): { readonly appliedIds: readonly string[] } {
    this.assertCanApply(migrations);
    this.open();
    const appliedIds: string[] = [];
    const existing = new Set(this.appliedIds());
    const insert = this.databaseOrThrow().prepare(
      "INSERT INTO _ef_preview_migrations (id, sql, applied_at_ms) VALUES (?, ?, ?)",
    );
    for (const migration of migrations) {
      if (existing.has(migration.id)) continue;
      const sql = assertAdditiveSql(migration.sql);
      this.databaseOrThrow().exec(sql);
      insert.run(migration.id, sql, this.now());
      existing.add(migration.id);
      appliedIds.push(migration.id);
    }
    return { appliedIds };
  }

  resetDemoData(): { readonly elapsedMs: number } {
    const started = Date.now();
    this.closeDatabase();
    this.options.templates.cloneFunctionalSeed(this.options.projectId, this.databaseFile());
    this.open();
    return { elapsedMs: Date.now() - started };
  }

  listOrders(): readonly Readonly<Record<string, string | null>>[] {
    this.open();
    const columns = this.databaseOrThrow()
      .prepare("PRAGMA table_info(orders)")
      .all()
      .map((row) => cell(row.name))
      .filter((name): name is string => typeof name === "string");
    const rows = this.databaseOrThrow().prepare("SELECT * FROM orders ORDER BY id").all();
    return rows.map((row) => {
      const record: Record<string, string | null> = {};
      for (const column of columns) record[column] = cell(row[column] ?? null);
      return record;
    });
  }

  seedMarker(): string | null {
    this.open();
    const row = this.databaseOrThrow()
      .prepare("SELECT value FROM demo_meta WHERE key = 'seed'")
      .get();
    if (!row) return null;
    return cell(row.value ?? null);
  }

  async startEndpoint(port: number): Promise<void> {
    if (this.engine !== "postgres") return;
    await this.stopEndpoint();
    this.open();
    const server = net.createServer((socket) => {
      let buffer = "";
      socket.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          socket.write(`${JSON.stringify(this.handleLine(line))}\n`);
          newline = buffer.indexOf("\n");
        }
      });
      socket.on("error", () => {
        socket.destroy();
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        server.removeAllListeners("error");
        resolve();
      });
    });
    this.endpoint = server;
  }

  async stopEndpoint(): Promise<void> {
    const server = this.endpoint;
    this.endpoint = null;
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  insertOrder(id: string, note: string): void {
    this.open();
    this.databaseOrThrow().prepare("INSERT INTO orders (id, note) VALUES (?, ?)").run(id, note);
  }

  close(): void {
    const server = this.endpoint;
    this.endpoint = null;
    server?.close();
    this.closeDatabase();
  }

  private handleLine(line: string): { ok: boolean; rows?: readonly Readonly<Record<string, string | null>>[]; error?: string } {
    let message: QueryMessage;
    try {
      message = JSON.parse(line) as QueryMessage;
    } catch {
      return { ok: false, error: "refused" };
    }
    if (message.op === "ping") return { ok: true };
    if (message.op === "query" && message.sql === "SELECT id, note FROM orders") {
      return { ok: true, rows: this.listOrders() };
    }
    return { ok: false, error: "refused" };
  }

  private appliedIds(): string[] {
    return this.databaseOrThrow()
      .prepare("SELECT id FROM _ef_preview_migrations")
      .all()
      .map((row) => cell(row.id))
      .filter((id): id is string => typeof id === "string");
  }

  private open(): void {
    if (this.database) return;
    if (!fs.existsSync(this.databaseFile())) {
      this.options.templates.cloneFunctionalSeed(this.options.projectId, this.databaseFile());
    }
    const database = new DatabaseSync(this.databaseFile());
    database.exec("PRAGMA busy_timeout = 3000");
    database.exec("PRAGMA journal_mode = DELETE");
    this.database = database;
  }

  private closeDatabase(): void {
    this.database?.close();
    this.database = null;
  }

  private databaseOrThrow(): DatabaseSync {
    if (!this.database) throw new Error("preview demo database is not open");
    return this.database;
  }
}
