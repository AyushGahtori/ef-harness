import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { NodeBinaryLauncher, type SpawnedServiceProcess } from "./binary-launcher.js";
import { systemClock, type Clock } from "./clock.js";
import { asStartFailure, ServiceStartFailedError } from "./errors.js";
import { TrackingWindowsJobManager, type JobHandle, type WindowsJobManager } from "./job.js";
import { reserveLoopbackPort, waitForTcp } from "./net-util.js";
import { efHarnessHome, existingComponent, projectServiceDir, readRedisDecisionText } from "./paths.js";
import { RedisDbIndexAllocator, type RedisPlacement } from "./redis-allocator.js";
import {
  redisBackendArgs,
  renderRedisIsolationConfig,
  resolveRedisServerChoice,
  type RedisServerKind,
} from "./redis-config.js";
import {
  flushRedisIndexes,
  RedisProtocolServer,
  startRedisGuardProxy,
} from "./redis-protocol.js";
import { ProjectSharedServerPool } from "./shared-server.js";
import type {
  EnvironmentDegradation,
  ProcessExitEvent,
  ServiceConnection,
  ServiceCreateRequest,
  ServiceProvider,
} from "./types.js";

export interface RedisLaunchRequest {
  readonly projectId: string;
  readonly serverKey: string;
  readonly dataDir: string;
  readonly backendPort: number;
  readonly job: JobHandle;
  readonly jobManager: WindowsJobManager;
  readonly server: RedisServerKind;
  readonly configText: string;
  readonly configPath: string;
  readonly componentsHome?: string;
}

export interface RedisServerRuntime {
  readonly pid: number;
  readonly backendPort: number;
  stderr(): string;
  onExit(listener: (event: ProcessExitEvent) => void): void;
  stop(): Promise<void>;
}

export interface RedisClusterLauncher {
  launch(request: RedisLaunchRequest): Promise<RedisServerRuntime>;
}

interface GuardedRedis {
  readonly publicPort: number;
  stderr(): string;
  onExit(listener: (event: ProcessExitEvent) => void): void;
  stop(): Promise<void>;
}

export interface RedisConnection extends ServiceConnection {
  readonly service: "redis";
  readonly url: string;
  readonly urls: readonly string[];
  readonly port: number;
  readonly dbIndex: number;
  readonly dbIndexes: readonly number[];
  readonly serverKey: string;
  readonly inProcess: boolean;
}

interface PlacementRecord {
  serverKey: string;
  indexes: number[];
  port: number;
}

interface RedisEnvRecord {
  projectId: string;
  placements: PlacementRecord[];
  inProcess: boolean;
}

interface Fleet {
  allocator: RedisDbIndexAllocator;
  mode: "fake" | "binary" | null;
}

export interface RedisCompatibleOptions {
  readonly jobManager?: WindowsJobManager;
  readonly launcher?: RedisClusterLauncher;
  readonly clock?: Clock;
  readonly idleGraceMs?: number;
  readonly home?: string;
  readonly server?: RedisServerKind;
  readonly envValue?: string;
  readonly decisionText?: string | null;
}

export class RedisCompatibleProvider implements ServiceProvider {
  readonly service = "redis" as const;
  readonly serverKind: RedisServerKind;
  private readonly jobManager: WindowsJobManager;
  private readonly launcher: RedisClusterLauncher;
  private readonly home: string;
  private readonly envs = new Map<string, RedisEnvRecord>();
  private readonly fleets = new Map<string, Fleet>();
  private readonly jobs = new Map<string, JobHandle>();
  private readonly degradationLog: EnvironmentDegradation[] = [];
  private readonly pool: ProjectSharedServerPool<GuardedRedis>;

  constructor(options: RedisCompatibleOptions = {}) {
    this.jobManager = options.jobManager ?? new TrackingWindowsJobManager();
    this.launcher = options.launcher ?? new RedisBinaryLauncher();
    this.home = options.home ?? efHarnessHome();
    const decisionText =
      options.decisionText === undefined ? readRedisDecisionText() : options.decisionText;
    this.serverKind =
      options.server ??
      resolveRedisServerChoice({
        envValue: options.envValue ?? process.env.EF_HARNESS_REDIS_SERVER ?? "",
        decisionText,
      });
    this.pool = new ProjectSharedServerPool({
      idleGraceMs: options.idleGraceMs ?? 5_000,
      clock: options.clock ?? systemClock(),
      start: (key) => this.startServer(key),
      stop: async (key, runtime) => {
        await runtime.stop();
        const parts = splitPoolKey(key);
        this.fleetFor(parts.projectId).allocator.retireIfEmpty(parts.serverKey);
      },
    });
  }

  degradations(): readonly EnvironmentDegradation[] {
    return [...this.degradationLog];
  }

  async create(request: ServiceCreateRequest): Promise<RedisConnection> {
    if (this.envs.has(request.envId)) {
      throw new Error(`redis environment ${request.envId} already exists`);
    }
    const mode = redisMode(request);
    const fleet = this.fleetFor(request.projectId);
    if (fleet.mode && fleet.mode !== mode) {
      throw new Error(`project ${request.projectId} already uses Redis mode ${fleet.mode}`);
    }
    fleet.mode = mode;
    const assignment = fleet.allocator.assign(request.envId, request.redisDatabaseCount ?? 1);
    const acquired: string[] = [];
    try {
      const placements: PlacementRecord[] = [];
      for (const placement of assignment.placements) {
        const key = poolKey(request.projectId, placement.serverKey);
        await this.pool.acquire(key);
        acquired.push(key);
        const runtime = this.pool.runtimeOf(key);
        if (!runtime) throw new ServiceStartFailedError("redis", "shared redis server is not running");
        await flushRedisIndexes(runtime.publicPort, placement.indexes);
        placements.push({
          serverKey: placement.serverKey,
          indexes: [...placement.indexes],
          port: runtime.publicPort,
        });
      }
      const record: RedisEnvRecord = {
        projectId: request.projectId,
        placements,
        inProcess: mode === "fake",
      };
      this.envs.set(request.envId, record);
      return this.connection(request.envId, record);
    } catch (error) {
      fleet.allocator.release(request.envId);
      for (const key of acquired) await this.pool.release(key);
      throw error;
    }
  }

  async resetData(envId: string): Promise<void> {
    const record = this.record(envId);
    for (const placement of record.placements) {
      const runtime = await this.serverForSql(record.projectId, placement.serverKey);
      await flushRedisIndexes(runtime.publicPort, placement.indexes);
    }
  }

  async destroy(envId: string): Promise<void> {
    const record = this.envs.get(envId);
    if (!record) return;
    this.envs.delete(envId);
    try {
      for (const placement of record.placements) {
        const runtime = await this.serverForSql(record.projectId, placement.serverKey);
        await flushRedisIndexes(runtime.publicPort, placement.indexes);
      }
    } finally {
      this.fleetFor(record.projectId).allocator.release(envId);
      for (const placement of record.placements) {
        await this.pool.release(poolKey(record.projectId, placement.serverKey));
      }
    }
  }

  async closeProject(projectId: string): Promise<void> {
    const ids = [...this.envs.entries()]
      .filter(([, record]) => record.projectId === projectId)
      .map(([envId]) => envId);
    for (const envId of ids) await this.destroy(envId);
    const prefix = `${projectId}::`;
    for (const key of [...this.poolKeys]) {
      if (!key.startsWith(prefix)) continue;
      await this.pool.close(key);
      this.poolKeys.delete(key);
    }
    this.fleets.delete(projectId);
    const job = this.jobs.get(projectId);
    if (job) {
      this.jobs.delete(projectId);
      await this.jobManager.terminateJob(job);
    }
  }

  private readonly poolKeys = new Set<string>();

  private connection(envId: string, record: RedisEnvRecord): RedisConnection {
    const urls = record.placements.flatMap((placement) =>
      placement.indexes.map((index) => `redis://127.0.0.1:${placement.port}/${index}`),
    );
    const primary = urls[0];
    const first = record.placements[0];
    if (!primary || !first || first.indexes[0] === undefined) {
      throw new Error("redis assignment did not produce a database index");
    }
    return {
      service: "redis",
      envId,
      projectId: record.projectId,
      url: primary,
      urls,
      port: first.port,
      dbIndex: first.indexes[0],
      dbIndexes: record.placements.flatMap((placement) => placement.indexes),
      serverKey: first.serverKey,
      inProcess: record.inProcess,
      variables: {
        REDIS_URL: primary,
        REDIS_URLS: urls.join(","),
      },
    };
  }

  private async serverForSql(projectId: string, serverKey: string): Promise<GuardedRedis> {
    const key = poolKey(projectId, serverKey);
    const current = this.pool.runtimeOf(key);
    if (current) return current;
    await this.pool.acquire(key);
    await this.pool.release(key);
    const restarted = this.pool.runtimeOf(key);
    if (!restarted) throw new ServiceStartFailedError("redis", "shared redis server is not running");
    return restarted;
  }

  private async startServer(key: string): Promise<GuardedRedis> {
    this.poolKeys.add(key);
    const { projectId, serverKey } = splitPoolKey(key);
    const fleet = this.fleetFor(projectId);
    try {
      if (fleet.mode === "fake") return await this.startInProcess();
      return await this.startBinary(projectId, serverKey);
    } catch (error) {
      throw asStartFailure("redis", error);
    }
  }

  private async startInProcess(): Promise<GuardedRedis> {
    const server = new RedisProtocolServer({ enforceDangerousCommandBan: true });
    const port = await server.start();
    return {
      publicPort: port,
      stderr: () => "",
      onExit() {
        return undefined;
      },
      async stop() {
        await server.stop();
      },
    };
  }

  private async startBinary(projectId: string, serverKey: string): Promise<GuardedRedis> {
    const job = await this.jobFor(projectId);
    const dataDir = projectServiceDir(this.home, projectId, path.join("redis", serverKey));
    await mkdir(dataDir, { recursive: true });
    const backendPort = await reserveLoopbackPort();
    const configText = renderRedisIsolationConfig({
      server: this.serverKind,
      port: backendPort,
      dataDir,
    });
    const configPath = path.join(dataDir, "redis.conf");
    await writeFile(configPath, configText, "utf8");
    const backend = await this.launcher.launch({
      projectId,
      serverKey,
      dataDir,
      backendPort,
      job,
      jobManager: this.jobManager,
      server: this.serverKind,
      configText,
      configPath,
      componentsHome: this.home,
    });
    const proxy = await startRedisGuardProxy(backend.backendPort);
    const runtime: GuardedRedis = {
      publicPort: proxy.port,
      stderr: () => backend.stderr(),
      onExit(listener) {
        backend.onExit(listener);
      },
      async stop() {
        await proxy.stop();
        await backend.stop();
      },
    };
    backend.onExit((event) => {
      if (event.intentional) return;
      if (this.pool.runtimeOf(poolKey(projectId, serverKey)) !== runtime) return;
      const stderr = event.stderr || backend.stderr();
      this.pool.notifyUnexpectedExit(poolKey(projectId, serverKey), stderr);
      this.markDegraded(projectId, serverKey, stderr);
    });
    return runtime;
  }

  private async jobFor(projectId: string): Promise<JobHandle> {
    const existing = this.jobs.get(projectId);
    if (existing) return existing;
    const created = await this.jobManager.createJob(`project-service:${projectId}:redis`, {
      killOnJobClose: true,
    });
    this.jobs.set(projectId, created);
    return created;
  }

  private fleetFor(projectId: string): Fleet {
    const existing = this.fleets.get(projectId);
    if (existing) return existing;
    const created: Fleet = { allocator: new RedisDbIndexAllocator(), mode: null };
    this.fleets.set(projectId, created);
    return created;
  }

  private record(envId: string): RedisEnvRecord {
    const record = this.envs.get(envId);
    if (!record) throw new Error(`unknown redis environment ${envId}`);
    return record;
  }

  private markDegraded(projectId: string, serverKey: string, stderr: string): void {
    for (const [envId, record] of this.envs) {
      if (record.projectId !== projectId) continue;
      if (!record.placements.some((placement) => placement.serverKey === serverKey)) continue;
      this.degradationLog.push({
        service: "redis",
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

function redisMode(request: ServiceCreateRequest): "fake" | "binary" {
  if (request.inProcessFake === true) {
    if (request.tier !== 1) {
      throw new Error(
        "in-process Redis fake is only available for Tier 1 unit-level checks when explicitly requested",
      );
    }
    return "fake";
  }
  return "binary";
}

function poolKey(projectId: string, serverKey: string): string {
  return `${projectId}::${serverKey}`;
}

function splitPoolKey(key: string): { projectId: string; serverKey: string } {
  const splitAt = key.indexOf("::");
  if (splitAt < 0) throw new Error(`bad redis pool key ${key}`);
  return { projectId: key.slice(0, splitAt), serverKey: key.slice(splitAt + 2) };
}

export class RedisBinaryLauncher implements RedisClusterLauncher {
  constructor(private readonly binaries: NodeBinaryLauncher = new NodeBinaryLauncher()) {}

  async launch(request: RedisLaunchRequest): Promise<RedisServerRuntime> {
    const binary = existingComponent(request.server, request.componentsHome);
    if (!binary) {
      const root = request.componentsHome ?? efHarnessHome();
      throw new ServiceStartFailedError(
        "redis",
        `missing ${request.server} binary under ${root}\\components. Antivirus quarantine or a missing VC++ runtime can also prevent startup.`,
      );
    }
    const server = await this.binaries.spawn({
      binary,
      args: redisBackendArgs({
        server: request.server,
        port: request.backendPort,
        dataDir: request.dataDir,
        configPath: request.configPath,
      }),
      job: request.job,
      jobManager: request.jobManager,
    });
    try {
      await waitForTcp("127.0.0.1", request.backendPort, 10_000);
    } catch (error) {
      const logs = `${server.stderr()}\n${error instanceof Error ? error.message : String(error)}`;
      await server.stop();
      throw new ServiceStartFailedError("redis", logs);
    }
    return wrapSpawned(server, request.backendPort);
  }
}

export function wrapSpawned(proc: SpawnedServiceProcess, backendPort: number): RedisServerRuntime {
  let stopped = false;
  return {
    pid: proc.pid,
    backendPort,
    stderr: () => proc.stderr(),
    onExit(listener) {
      proc.onExit((event) => listener({ ...event, intentional: stopped || event.intentional }));
    },
    async stop() {
      stopped = true;
      await proc.stop();
    },
  };
}

export type { RedisPlacement };
