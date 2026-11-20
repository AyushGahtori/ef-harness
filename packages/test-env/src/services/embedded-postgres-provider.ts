import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { NodeBinaryLauncher, type SpawnedServiceProcess } from "./binary-launcher.js";
import { systemClock, type Clock } from "./clock.js";
import { asStartFailure, ServiceStartFailedError, UnsupportedPostgresExtensionError } from "./errors.js";
import { TrackingWindowsJobManager, type JobHandle, type WindowsJobManager } from "./job.js";
import { reserveLoopbackPort, waitForTcp } from "./net-util.js";
import { efHarnessHome, existingComponent, projectServiceDir } from "./paths.js";
import {
  buildCreateDatabaseCommands,
  buildDropDatabaseCommands,
  DEFAULT_STATEMENT_TIMEOUT_MS,
  EMBEDDED_POSTGRES_EXTENSIONS,
  LIVE_EXTENSION_SQL,
  postgresConnectionString,
  postgresDatabaseName,
  statementTimeoutOption,
  type SqlCommand,
} from "./postgres-sql.js";
import { ProjectSharedServerPool } from "./shared-server.js";
import type {
  EnvironmentDegradation,
  ProcessExitEvent,
  ServiceConnection,
  ServiceCreateRequest,
  ServiceProvider,
} from "./types.js";

export interface PostgresAdminSession {
  query(sql: string, params?: readonly unknown[]): Promise<readonly Record<string, unknown>[]>;
  close(): Promise<void>;
}

export interface PostgresClusterRuntime {
  readonly port: number;
  readonly pid: number;
  stderr(): string;
  onExit(listener: (event: ProcessExitEvent) => void): void;
  stop(): Promise<void>;
  connect(): Promise<PostgresAdminSession>;
}

export interface PostgresLaunchRequest {
  readonly projectId: string;
  readonly dataDir: string;
  readonly port: number;
  readonly job: JobHandle;
  readonly jobManager: WindowsJobManager;
  readonly componentsHome?: string;
}

export interface PostgresClusterLauncher {
  launch(request: PostgresLaunchRequest): Promise<PostgresClusterRuntime>;
}

export interface PostgresConnection extends ServiceConnection {
  readonly service: "postgres";
  readonly connectionString: string;
  readonly database: string;
  readonly user: string;
  readonly port: number;
  readonly statementTimeoutMs: number;
  readonly statementTimeoutOption: string;
}

interface PostgresEnvRecord {
  projectId: string;
  database: string;
  password: string;
  templateDatabase: string | null;
  statementTimeoutMs: number;
  degraded: boolean;
}

export interface EmbeddedPostgresOptions {
  readonly jobManager?: WindowsJobManager;
  readonly launcher?: PostgresClusterLauncher;
  readonly clock?: Clock;
  readonly idleGraceMs?: number;
  readonly home?: string;
  readonly embeddedExtensions?: readonly string[];
}

export class EmbeddedPostgresProvider implements ServiceProvider {
  readonly service = "postgres" as const;
  private readonly jobManager: WindowsJobManager;
  private readonly launcher: PostgresClusterLauncher;
  private readonly home: string;
  private readonly embeddedExtensions: ReadonlySet<string>;
  private readonly envs = new Map<string, PostgresEnvRecord>();
  private readonly jobs = new Map<string, JobHandle>();
  private readonly preferredPorts = new Map<string, number>();
  private readonly boundPorts = new Map<string, number>();
  private readonly degradationLog: EnvironmentDegradation[] = [];
  private readonly pool: ProjectSharedServerPool<PostgresClusterRuntime>;

  constructor(options: EmbeddedPostgresOptions = {}) {
    this.jobManager = options.jobManager ?? new TrackingWindowsJobManager();
    this.launcher = options.launcher ?? new EmbeddedPostgresBinaryLauncher();
    this.home = options.home ?? efHarnessHome();
    this.embeddedExtensions = new Set(options.embeddedExtensions ?? EMBEDDED_POSTGRES_EXTENSIONS);
    const clock = options.clock ?? systemClock();
    const idleGraceMs = options.idleGraceMs ?? 5_000;
    this.pool = new ProjectSharedServerPool<PostgresClusterRuntime>({
      idleGraceMs,
      clock,
      start: (projectId) => this.startServer(projectId),
      stop: async (_projectId, runtime) => {
        await runtime.stop();
      },
    });
  }

  degradations(): readonly EnvironmentDegradation[] {
    return [...this.degradationLog];
  }

  async create(request: ServiceCreateRequest): Promise<PostgresConnection> {
    if (this.envs.has(request.envId)) {
      throw new Error(`postgres environment ${request.envId} already exists`);
    }
    this.assertStaticExtensions(request.extensions);
    const preferred = request.ports?.pg;
    if (preferred !== undefined) this.preferredPorts.set(request.projectId, preferred);
    const database = postgresDatabaseName(request.envId);
    const password = randomBytes(18).toString("hex");
    const statementTimeoutMs = request.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS;
    const record: PostgresEnvRecord = {
      projectId: request.projectId,
      database,
      password,
      templateDatabase: request.templateDatabase ?? null,
      statementTimeoutMs,
      degraded: false,
    };
    await this.pool.acquire(request.projectId);
    try {
      const runtime = this.pool.runtimeOf(request.projectId);
      if (!runtime) throw new ServiceStartFailedError("postgres", "shared postgres server is not running");
      await this.assertLiveExtensions(runtime, request.extensions);
      await execSql(runtime, buildCreateDatabaseCommands({
        database,
        password,
        statementTimeoutMs,
        ...(record.templateDatabase ? { templateDatabase: record.templateDatabase } : {}),
      }));
    } catch (error) {
      await this.pool.release(request.projectId);
      throw error;
    }
    this.envs.set(request.envId, record);
    return this.connection(request.envId, record);
  }

  async resetData(envId: string): Promise<void> {
    const record = this.record(envId);
    const runtime = await this.serverForSql(record.projectId);
    await execSql(runtime, buildDropDatabaseCommands(record.database));
    await execSql(runtime, buildCreateDatabaseCommands({
      database: record.database,
      password: record.password,
      statementTimeoutMs: record.statementTimeoutMs,
      ...(record.templateDatabase ? { templateDatabase: record.templateDatabase } : {}),
    }));
    record.degraded = false;
  }

  async destroy(envId: string): Promise<void> {
    const record = this.envs.get(envId);
    if (!record) return;
    this.envs.delete(envId);
    try {
      const runtime = await this.serverForSql(record.projectId);
      await execSql(runtime, buildDropDatabaseCommands(record.database));
    } finally {
      await this.pool.release(record.projectId);
    }
  }

  async closeProject(projectId: string): Promise<void> {
    const ids = [...this.envs.entries()]
      .filter(([, record]) => record.projectId === projectId)
      .map(([envId]) => envId);
    for (const envId of ids) {
      await this.destroy(envId);
    }
    await this.pool.close(projectId);
    const job = this.jobs.get(projectId);
    if (job) {
      this.jobs.delete(projectId);
      await this.jobManager.terminateJob(job);
    }
  }

  /**
   * Returns the shared server without taking an environment reference.
   * A crashed server is restarted, then the extra reference is returned,
   * leaving the existing environment count unchanged.
   */
  private async serverForSql(projectId: string): Promise<PostgresClusterRuntime> {
    const current = this.pool.runtimeOf(projectId);
    if (current) return current;
    await this.pool.acquire(projectId);
    await this.pool.release(projectId);
    const restarted = this.pool.runtimeOf(projectId);
    if (!restarted) {
      throw new ServiceStartFailedError("postgres", "shared postgres server is not running");
    }
    return restarted;
  }

  private connection(envId: string, record: PostgresEnvRecord): PostgresConnection {
    const runtime = this.pool.runtimeOf(record.projectId);
    const port = runtime?.port ?? this.boundPorts.get(record.projectId) ?? 0;
    const option = statementTimeoutOption(record.statementTimeoutMs);
    const connectionString = postgresConnectionString({
      user: record.database,
      password: record.password,
      port,
      database: record.database,
      statementTimeoutMs: record.statementTimeoutMs,
    });
    return {
      service: "postgres",
      envId,
      projectId: record.projectId,
      connectionString,
      database: record.database,
      user: record.database,
      port,
      statementTimeoutMs: record.statementTimeoutMs,
      statementTimeoutOption: option,
      variables: { DATABASE_URL: connectionString },
    };
  }

  private assertStaticExtensions(extensions: readonly string[] | undefined): void {
    for (const extension of extensions ?? []) {
      if (!this.embeddedExtensions.has(extension)) {
        throw new UnsupportedPostgresExtensionError(extension);
      }
    }
  }

  private async assertLiveExtensions(
    runtime: PostgresClusterRuntime,
    extensions: readonly string[] | undefined,
  ): Promise<void> {
    if (!extensions || extensions.length === 0) return;
    const session = await runtime.connect();
    try {
      for (const extension of extensions) {
        const rows = await session.query(LIVE_EXTENSION_SQL, [extension]);
        if (rows.length === 0) throw new UnsupportedPostgresExtensionError(extension);
      }
    } finally {
      await session.close();
    }
  }

  private async startServer(projectId: string): Promise<PostgresClusterRuntime> {
    const job = await this.jobFor(projectId);
    const dataDir = projectServiceDir(this.home, projectId, "pg");
    await mkdir(dataDir, { recursive: true });
    const port = await this.portFor(projectId);
    let runtime: PostgresClusterRuntime;
    try {
      runtime = await this.launcher.launch({
        projectId,
        dataDir,
        port,
        job,
        jobManager: this.jobManager,
        ...(this.home ? { componentsHome: this.home } : {}),
      });
    } catch (error) {
      throw asStartFailure("postgres", error);
    }
    runtime.onExit((event) => {
      if (event.intentional) return;
      if (this.pool.runtimeOf(projectId) !== runtime) return;
      const stderr = event.stderr || runtime.stderr();
      this.pool.notifyUnexpectedExit(projectId, stderr);
      this.markDegraded(projectId, stderr);
    });
    return runtime;
  }

  private async portFor(projectId: string): Promise<number> {
    const existing = this.boundPorts.get(projectId);
    if (existing !== undefined) return existing;
    const preferred = this.preferredPorts.get(projectId);
    const port = preferred ?? (await reserveLoopbackPort());
    this.boundPorts.set(projectId, port);
    return port;
  }

  private async jobFor(projectId: string): Promise<JobHandle> {
    const existing = this.jobs.get(projectId);
    if (existing) return existing;
    const created = await this.jobManager.createJob(`project-service:${projectId}:postgres`, {
      killOnJobClose: true,
    });
    this.jobs.set(projectId, created);
    return created;
  }

  private record(envId: string): PostgresEnvRecord {
    const record = this.envs.get(envId);
    if (!record) throw new Error(`unknown postgres environment ${envId}`);
    return record;
  }

  private markDegraded(projectId: string, stderr: string): void {
    for (const [envId, record] of this.envs) {
      if (record.projectId !== projectId || record.degraded) continue;
      record.degraded = true;
      this.degradationLog.push({
        service: "postgres",
        projectId,
        envId,
        state: "degraded",
        stderr,
        workerQualityPenalty: false,
        failureScope: "environment",
      });
    }
  }
}

async function execSql(runtime: PostgresClusterRuntime, commands: readonly SqlCommand[]): Promise<void> {
  const session = await runtime.connect();
  try {
    for (const command of commands) {
      await session.query(command.sql, command.params);
    }
  } finally {
    await session.close();
  }
}

export class EmbeddedPostgresBinaryLauncher implements PostgresClusterLauncher {
  constructor(private readonly binaries: NodeBinaryLauncher = new NodeBinaryLauncher()) {}

  async launch(request: PostgresLaunchRequest): Promise<PostgresClusterRuntime> {
    const postgres = existingComponent("postgres", request.componentsHome);
    const initdb = existingComponent("initdb", request.componentsHome);
    if (!postgres || !initdb) {
      const root = request.componentsHome ?? efHarnessHome();
      throw new ServiceStartFailedError(
        "postgres",
        `missing embedded postgres binary under ${root}\\components. Antivirus quarantine or a missing VC++ runtime can also prevent startup.`,
      );
    }
    const versionFile = path.join(request.dataDir, "PG_VERSION");
    if (!existsSync(versionFile)) {
      const init = await this.binaries.spawn({
        binary: initdb,
        args: ["-D", request.dataDir, "-U", "postgres", "--auth=trust", "--encoding=UTF8", "--locale=C", "--no-sync"],
        job: request.job,
        jobManager: request.jobManager,
      });
      const code = await init.waitForExit();
      if (code !== 0) {
        throw new ServiceStartFailedError("postgres", init.stderr() || `initdb exited ${code}`);
      }
    }
    const server = await this.binaries.spawn({
      binary: postgres,
      args: postgresServerArgs(request.dataDir, request.port),
      job: request.job,
      jobManager: request.jobManager,
    });
    try {
      await waitForTcp("127.0.0.1", request.port, 20_000);
    } catch (error) {
      const logs = `${server.stderr()}\n${error instanceof Error ? error.message : String(error)}`;
      await server.stop();
      throw new ServiceStartFailedError("postgres", logs);
    }
    if (server.exited()) {
      throw new ServiceStartFailedError(
        "postgres",
        server.stderr() || "postgres exited before it accepted connections",
      );
    }
    return new BinaryPostgresRuntime(server, request.port, request.componentsHome);
  }
}

export function postgresServerArgs(dataDir: string, port: number): readonly string[] {
  return ["-D", dataDir, "-p", String(port), "-h", "127.0.0.1", "-k", ""];
}

class BinaryPostgresRuntime implements PostgresClusterRuntime {
  private stopped = false;

  constructor(
    private readonly proc: SpawnedServiceProcess,
    readonly port: number,
    private readonly componentsHome: string | undefined,
  ) {}

  get pid(): number {
    return this.proc.pid;
  }

  stderr(): string {
    return this.proc.stderr();
  }

  onExit(listener: (event: ProcessExitEvent) => void): void {
    this.proc.onExit((event) => {
      listener({ ...event, intentional: this.stopped || event.intentional });
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.proc.stop();
  }

  async connect(): Promise<PostgresAdminSession> {
    const psql = existingComponent("psql", this.componentsHome);
    if (!psql) {
      throw new ServiceStartFailedError(
        "postgres",
        "psql was not found beside the embedded postgres binary, so SQL could not be sent",
      );
    }
    return new PsqlAdminSession(psql, this.port);
  }
}

class PsqlAdminSession implements PostgresAdminSession {
  constructor(
    private readonly psql: string,
    private readonly port: number,
  ) {}

  async query(sql: string, params: readonly unknown[] = []): Promise<readonly Record<string, unknown>[]> {
    const rendered = applySafeParams(sql, params);
    const stdout = await runPsql(this.psql, [
      "-h",
      "127.0.0.1",
      "-p",
      String(this.port),
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-t",
      "-A",
      "-c",
      rendered,
    ]);
    const text = stdout.trim();
    if (!text) return [];
    if (sql.includes("pg_available_extensions")) return [{ name: text }];
    return [{ result: text }];
  }

  async close(): Promise<void> {
    return undefined;
  }
}

function applySafeParams(sql: string, params: readonly unknown[]): string {
  return sql.replace(/\$(\d+)/g, (_match, index: string) => {
    const value = params[Number(index) - 1];
    if (typeof value !== "string" || !/^[a-z_][a-z0-9_]*$/i.test(value)) {
      throw new Error("refusing to interpolate an unsafe postgres parameter");
    }
    return `'${value}'`;
  });
}

function runPsql(binary: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(binary, [...args], { windowsHide: true, encoding: "utf8" }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}
