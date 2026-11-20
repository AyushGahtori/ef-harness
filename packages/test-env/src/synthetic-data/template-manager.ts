import fs from "node:fs";
import path from "node:path";
import { SyntheticDataGenerator } from "./generate.js";
import { sha256Hex } from "./hash.js";
import { hashSeedRecipe, parseRecipe } from "./recipe.js";
import { quoteIdent } from "./sql.js";
import { loadDatasetSqlite, openSqlite } from "./sqlite-engine.js";
import type {
  CloneHandle,
  EmbeddedPostgresProviderPort,
  PruneResult,
  SeedProfile,
  SqliteEnvProviderPort,
  SqlPrimitive,
  TemplateBuildRequest,
  TemplateHandle,
  TemplateManagerStats,
} from "./types.js";

export function hashMigrations(migrations: readonly string[]): string {
  return sha256Hex(migrations.map((sql) => sql.normalize("NFC")).join("\n--ef-migration--\n"));
}

export function computeTemplateKey(
  migrationsHash: string,
  seedRecipeHash: string,
  profile: string,
): string {
  return sha256Hex(`${migrationsHash}:${seedRecipeHash}:${profile}`);
}

export function environmentDatabaseName(envId: string): string {
  const cleaned = envId.replace(/[^A-Za-z0-9_]/g, "_").replace(/^_+/, "");
  const base = `env_${cleaned || "id"}`;
  if (base.length <= 63 && /^[A-Za-z_]/.test(base)) return base;
  return `env_${sha256Hex(envId).slice(0, 16)}`;
}

export class LocalSqliteFilePort implements SqliteEnvProviderPort {
  async copyTemplateFile(templatePath: string, destinationPath: string): Promise<void> {
    await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.promises.copyFile(templatePath, destinationPath);
    await fs.promises.chmod(destinationPath, 0o644);
  }

  async removeDatabaseFile(filePath: string): Promise<void> {
    if (!fs.existsSync(filePath)) return;
    await fs.promises.chmod(filePath, 0o666);
    await fs.promises.rm(filePath, { force: true });
  }
}

interface TemplateRecord {
  readonly handle: TemplateHandle;
  readonly sequence: number;
  readonly activeClones: Set<string>;
}

export interface TemplateDatabaseManagerOptions {
  readonly projectId: string;
  readonly rootDir: string;
  readonly dialect: "sqlite" | "postgres";
  readonly keep?: number;
  readonly sqlite?: SqliteEnvProviderPort;
  readonly postgres?: EmbeddedPostgresProviderPort;
  readonly clock?: () => number;
  readonly buildGate?: () => Promise<void>;
}

export class DiskLane {
  private locked = false;
  private readonly waiters: Array<() => void> = [];

  run<T>(task: () => Promise<T>): Promise<T> {
    return this.acquire().then(async () => {
      try {
        return await task();
      } finally {
        this.release();
      }
    });
  }

  private acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.locked = false;
  }
}

export class TemplateDatabaseManager {
  private readonly generator = new SyntheticDataGenerator();
  private readonly lane = new DiskLane();
  private readonly ready = new Map<string, TemplateRecord>();
  private readonly names = new Map<string, string>();
  private readonly inflight = new Map<string, Promise<TemplateHandle>>();
  private readonly sqlitePort: SqliteEnvProviderPort;
  private readonly prewarmErrors: unknown[] = [];
  private sequence = 0;
  private buildsStarted = 0;
  private buildsCompleted = 0;
  private dedupedWaits = 0;
  private cloneCount = 0;
  private pruned = 0;

  constructor(private readonly options: TemplateDatabaseManagerOptions) {
    this.sqlitePort = options.sqlite ?? new LocalSqliteFilePort();
    if (options.dialect === "postgres" && !options.postgres) {
      throw new Error("Postgres template builds require an EmbeddedPostgresProvider port");
    }
  }

  prewarmTemplate(request: TemplateBuildRequest): void {
    try {
      void this.ensureTemplate(request).catch((error: unknown) => {
        this.prewarmErrors.push(error);
      });
    } catch (error) {
      this.prewarmErrors.push(error);
    }
  }

  ensureTemplate(request: TemplateBuildRequest): Promise<TemplateHandle> {
    const prepared = this.prepare(request);
    const cached = this.ready.get(prepared.key);
    if (cached) return Promise.resolve(cached.handle);
    const pending = this.inflight.get(prepared.key);
    if (pending) {
      this.dedupedWaits += 1;
      return pending;
    }
    const promise = this.lane.run(async () => {
      this.buildsStarted += 1;
      if (this.options.buildGate) await this.options.buildGate();
      const existing = this.ready.get(prepared.key);
      if (existing) return existing.handle;
      return this.build(prepared);
    });
    this.inflight.set(prepared.key, promise);
    void promise.then(
      (handle) => {
        this.ready.set(prepared.key, {
          handle,
          sequence: ++this.sequence,
          activeClones: new Set(),
        });
        this.names.set(handle.name, prepared.key);
        this.buildsCompleted += 1;
        this.inflight.delete(prepared.key);
      },
      () => {
        this.inflight.delete(prepared.key);
      },
    );
    return promise;
  }

  async cloneFromTemplate(template: TemplateHandle, envId: string): Promise<CloneHandle> {
    const record = this.ready.get(template.templateKey);
    if (!record || !record.handle.locked) {
      throw new Error(`Template ${template.name} is not locked`);
    }
    const name = environmentDatabaseName(envId);
    if (record.activeClones.has(envId)) {
      throw new Error(`Environment ${envId} already has a clone of ${template.name}`);
    }
    const location =
      this.options.dialect === "sqlite"
        ? path.join(this.options.rootDir, this.options.projectId, "clones", `${name}.sqlite`)
        : name;
    if (this.options.dialect === "sqlite") {
      await this.sqlitePort.copyTemplateFile(record.handle.location, location);
    } else {
      const postgres = this.postgres();
      const admin = await postgres.connectAdmin();
      try {
        await admin.query(
          `CREATE DATABASE ${quoteIdent(name)} TEMPLATE ${quoteIdent(record.handle.name)}`,
        );
      } finally {
        await admin.close();
      }
    }
    record.activeClones.add(envId);
    this.cloneCount += 1;
    let released = false;
    return {
      envId,
      name,
      location,
      templateKey: record.handle.templateKey,
      dialect: this.options.dialect,
      release: async () => {
        if (released) return;
        released = true;
        record.activeClones.delete(envId);
        if (this.options.dialect === "sqlite") {
          await this.sqlitePort.removeDatabaseFile(location);
        } else {
          await this.dropPostgresDatabase(name);
        }
      },
    };
  }

  async pruneOldTemplates(options?: { readonly keep?: number }): Promise<PruneResult> {
    const keep = options?.keep ?? this.options.keep ?? 5;
    const records = [...this.ready.values()].sort((left, right) => right.sequence - left.sequence);
    const removed: string[] = [];
    const skipped: string[] = [];
    const retained: string[] = [];
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      if (!record) continue;
      if (index < keep) {
        retained.push(record.handle.name);
        continue;
      }
      if (record.activeClones.size > 0) {
        skipped.push(record.handle.name);
        retained.push(record.handle.name);
        continue;
      }
      await this.dropRecord(record);
      removed.push(record.handle.name);
      this.pruned += 1;
    }
    return { keep, removed, skipped, retained };
  }

  listTemplates(): readonly TemplateHandle[] {
    return [...this.ready.values()]
      .sort((left, right) => right.sequence - left.sequence)
      .map((record) => record.handle);
  }

  stats(): TemplateManagerStats {
    return {
      buildsStarted: this.buildsStarted,
      buildsCompleted: this.buildsCompleted,
      dedupedWaits: this.dedupedWaits,
      clones: this.cloneCount,
      pruned: this.pruned,
      ready: this.ready.size,
      inflight: this.inflight.size,
    };
  }

  takePrewarmErrors(): readonly unknown[] {
    return this.prewarmErrors.splice(0, this.prewarmErrors.length);
  }

  async whenIdle(): Promise<void> {
    while (this.inflight.size > 0) {
      await Promise.allSettled([...this.inflight.values()]);
    }
  }

  private prepare(request: TemplateBuildRequest): {
    readonly key: string;
    readonly name: string;
    readonly request: TemplateBuildRequest;
    readonly migrationsHash: string;
    readonly seedRecipeHash: string;
    readonly profile: SeedProfile;
  } {
    if (request.migrations.length === 0) {
      throw new Error("Template build requires at least one migration");
    }
    const recipe = parseRecipe(request.seedRecipe);
    const profile = request.profile ?? recipe.profile;
    const effective = profile === recipe.profile ? recipe : { ...recipe, profile };
    const migrationsHash = request.migrationsHash ?? hashMigrations(request.migrations);
    const seedRecipeHash = hashSeedRecipe(effective);
    const key = computeTemplateKey(migrationsHash, seedRecipeHash, profile);
    const name = this.allocateName(key);
    this.names.set(name, key);
    return {
      key,
      name,
      request: { ...request, seedRecipe: effective, ...(request.profile ? { profile } : { profile }) },
      migrationsHash,
      seedRecipeHash,
      profile,
    };
  }

  private allocateName(key: string): string {
    for (let length = 12; length <= 32; length += 4) {
      const name = `tpl_${key.slice(0, length)}`;
      const owner = this.names.get(name);
      if (!owner || owner === key) return name;
    }
    return `tpl_${key.slice(0, 32)}`;
  }

  private async build(prepared: {
    key: string;
    name: string;
    request: TemplateBuildRequest;
    migrationsHash: string;
    seedRecipeHash: string;
    profile: SeedProfile;
  }): Promise<TemplateHandle> {
    const recipe = parseRecipe(prepared.request.seedRecipe);
    const dataset = this.generator.generateDataset(prepared.request.schema, {
      ...recipe,
      profile: prepared.profile,
    });
    const location =
      this.options.dialect === "sqlite"
        ? await this.buildSqlite(prepared.name, prepared.request.migrations, dataset)
        : await this.buildPostgres(prepared.name, prepared.request.migrations, dataset);
    const handle: TemplateHandle = {
      templateKey: prepared.key,
      name: prepared.name,
      projectId: this.options.projectId,
      profile: prepared.profile,
      dialect: this.options.dialect,
      location,
      locked: true,
      createdAt: (this.options.clock ?? Date.now)(),
      migrationsHash: prepared.migrationsHash,
      seedRecipeHash: prepared.seedRecipeHash,
      checksums: dataset.checksums,
      rowCounts: dataset.tables.map((table) => ({ table: table.name, rows: table.rows.length })),
    };
    return handle;
  }

  private async buildSqlite(
    name: string,
    migrations: readonly string[],
    dataset: ReturnType<SyntheticDataGenerator["generateDataset"]>,
  ): Promise<string> {
    const file = path.join(this.options.rootDir, this.options.projectId, `${name}.sqlite`);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const db = openSqlite(file);
    try {
      for (const migration of migrations) {
        if (migration.trim()) db.exec(migration);
      }
      db.exec("PRAGMA foreign_keys = ON");
      loadDatasetSqlite(db, dataset);
    } catch (error) {
      db.close();
      await this.sqlitePort.removeDatabaseFile(file);
      throw error;
    }
    db.close();
    await lockReadOnly(file);
    return file;
  }

  private async buildPostgres(
    name: string,
    migrations: readonly string[],
    dataset: ReturnType<SyntheticDataGenerator["generateDataset"]>,
  ): Promise<string> {
    const postgres = this.postgres();
    const admin = await postgres.connectAdmin();
    try {
      await admin.query(`CREATE DATABASE ${quoteIdent(name)}`);
    } finally {
      await admin.close();
    }
    const session = await postgres.connectDatabase(name);
    try {
      for (const migration of migrations) {
        if (migration.trim()) await session.query(migration);
      }
      for (const copy of dataset.bulk.postgresCopy) {
        await session.copyFromStdin(copy.sql, copy.stdin);
      }
      for (const batch of dataset.bulk.postgresInserts) {
        if (!batch.sql.startsWith("UPDATE")) continue;
        await session.query(batch.sql, batch.params.map(toPrimitive));
      }
    } catch (error) {
      await session.close();
      await this.dropPostgresDatabase(name);
      throw error;
    }
    await session.close();
    await postgres.closeDatabasePool(name);
    const lock = await postgres.connectAdmin();
    try {
      await lock.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
        [name],
      );
      await lock.query(`ALTER DATABASE ${quoteIdent(name)} WITH ALLOW_CONNECTIONS false`);
    } finally {
      await lock.close();
    }
    return name;
  }

  private async dropRecord(record: TemplateRecord): Promise<void> {
    this.ready.delete(record.handle.templateKey);
    this.names.delete(record.handle.name);
    if (record.handle.dialect === "sqlite") {
      await this.sqlitePort.removeDatabaseFile(record.handle.location);
      return;
    }
    await this.dropPostgresDatabase(record.handle.name);
  }

  private async dropPostgresDatabase(name: string): Promise<void> {
    const postgres = this.postgres();
    await postgres.closeDatabasePool(name);
    const admin = await postgres.connectAdmin();
    try {
      await admin.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
        [name],
      );
      await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(name)}`);
    } finally {
      await admin.close();
    }
  }

  private postgres(): EmbeddedPostgresProviderPort {
    if (!this.options.postgres) {
      throw new Error("Postgres template builds require an EmbeddedPostgresProvider port");
    }
    return this.options.postgres;
  }
}

async function lockReadOnly(file: string): Promise<void> {
  await fs.promises.chmod(file, 0o444);
  try {
    const handle = await fs.promises.open(file, "r+");
    await handle.close();
  } catch {
    return;
  }
  throw new Error(`Template file stayed writable after read-only lock: ${file}`);
}

function toPrimitive(value: import("./types.js").DataValue): SqlPrimitive {
  if (value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}
