import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GlobalBrokerDb,
  openProjectStateDb,
  type AuxiliaryLogger,
  type ProjectStateDb,
  type StateDbLogger,
} from "@ef-harness/db";
import { SERVICE_NAMES } from "../../src/orchestrator/index.js";
import type {
  EnvProcessRecord,
  HardwareAdmissionGate,
  JobAccounting,
  JobHandle,
  OrphanReconcileReport,
  ServiceProvisionContext,
  ServiceProvisionResult,
  ServiceProvider,
  WindowsJobManager,
} from "../../src/orchestrator/index.js";
import {
  ensureBrokerProject,
  MapSecretVault,
  ServiceProviderRegistry,
  SqliteEnvProcessStore,
  SqlitePortLeaseStore,
  TestEnvOrchestrator,
} from "../../src/orchestrator/index.js";
import type { TestEnvOrchestratorOptions } from "../../src/orchestrator/index.js";

export const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

export function nodeCommand(script: string): string {
  return `"${process.execPath}" "${path.join(fixtureDir, script)}"`;
}

export function yamlCommand(script: string): string {
  return `'${nodeCommand(script).replaceAll("'", "''")}'`;
}

export class RecordingProvider implements ServiceProvider {
  readonly provisions: ServiceProvisionContext[] = [];
  resets = 0;
  destroys = 0;
  starts = 0;
  failProvision = false;

  constructor(readonly serviceName: string) {}

  async provision(context: ServiceProvisionContext): Promise<ServiceProvisionResult> {
    if (this.failProvision) {
      throw new Error(`provision failed for ${this.serviceName}`);
    }
    this.provisions.push(context);
    if (this.serviceName === "sqlite") {
      const file = path.join(context.directories.temp, "app.sqlite");
      await fs.writeFile(file, "", "utf8");
      return {
        namespaceId: `${context.environmentId}:sqlite`,
        dbName: context.dbName,
        url: `file://${file}`,
      };
    }
    return {
      namespaceId: `${context.environmentId}:${this.serviceName}`,
      dbName: context.dbName,
      url: context.port === null ? null : `http://127.0.0.1:${context.port}`,
    };
  }

  async resetData(): Promise<void> {
    this.resets += 1;
  }

  async destroy(): Promise<void> {
    this.destroys += 1;
  }

  async start(context: ServiceProvisionContext): Promise<{ url: string }> {
    this.starts += 1;
    return {
      url:
        context.port === null ? `memory://${context.dbName}` : `http://127.0.0.1:${context.port}`,
    };
  }
}

interface TrackedJob {
  readonly handle: JobHandle;
  readonly limitsKillOnClose: boolean;
  readonly parentName?: string;
  readonly activeProcessLimit?: number;
  pids: Set<number>;
  terminated: boolean;
}

export class TrackingJobManager implements WindowsJobManager {
  constructor(private readonly registry: { list(): readonly EnvProcessRecord[] }) {}
  readonly created: TrackedJob[] = [];
  readonly warnings: string[] = [];
  readonly liveIdentities = new Map<number, number>();
  forceMemoryBytes: number | null = null;

  createJob(request: {
    name: string;
    kind: JobHandle["kind"];
    parentName?: string;
    limits: { killOnJobClose: true; activeProcessLimit?: number };
  }): JobHandle {
    const handle: JobHandle = { name: request.name, kind: request.kind };
    const tracked: TrackedJob = {
      handle,
      limitsKillOnClose: request.limits.killOnJobClose,
      pids: new Set(),
      terminated: false,
      ...(request.parentName !== undefined ? { parentName: request.parentName } : {}),
      ...(request.limits.activeProcessLimit !== undefined
        ? { activeProcessLimit: request.limits.activeProcessLimit }
        : {}),
    };
    this.created.push(tracked);
    return handle;
  }

  assignProcess(job: JobHandle, pid: number): void {
    this.require(job).pids.add(pid);
  }

  queryJobAccounting(job: JobHandle): JobAccounting {
    const tracked = this.require(job);
    const alive = [...tracked.pids].filter((pid) => isAlive(pid));
    tracked.pids = new Set(alive);
    const memory = this.forceMemoryBytes ?? 0;
    return {
      activeProcesses: tracked.terminated ? 0 : alive.length,
      peakMemoryBytes: memory,
      currentMemoryBytes: memory,
      userCpuMs: 0,
      kernelCpuMs: 0,
    };
  }

  async terminateJob(job: JobHandle): Promise<void> {
    const tracked = this.require(job);
    tracked.terminated = true;
    for (const pid of tracked.pids) killTree(pid);
    tracked.pids.clear();
  }

  async reconcileOrphanedProcesses(): Promise<OrphanReconcileReport> {
    const records = this.registry.list();
    const terminated: EnvProcessRecord[] = [];
    const skipped: OrphanReconcileReport["skipped"][number][] = [];
    for (const record of records) {
      const observed = this.liveIdentities.get(record.pid);
      if (observed === undefined) {
        const alive = isAlive(record.pid);
        if (alive) {
          this.warnings.push(`leave pid ${record.pid}: ownership not established`);
        }
        skipped.push({
          record,
          reason: alive ? "ownership not established" : "process not alive",
          removeRecord: !alive,
        });
        continue;
      }
      if (observed !== record.startTime) {
        this.warnings.push(`skip pid ${record.pid}: start_time mismatch`);
        skipped.push({ record, reason: "start_time mismatch", removeRecord: true });
        continue;
      }
      killTree(record.pid);
      terminated.push(record);
    }
    return { terminated, skipped };
  }

  private require(job: JobHandle): TrackedJob {
    const tracked = this.created.find((item) => item.handle.name === job.name);
    if (!tracked) throw new Error(`unknown job ${job.name}`);
    return tracked;
  }
}

export interface TestHarness {
  readonly orchestrator: TestEnvOrchestrator;
  readonly portLeases: SqlitePortLeaseStore;
  readonly envProcesses: SqliteEnvProcessStore;
  readonly jobs: TrackingJobManager;
  readonly providers: Map<string, RecordingProvider>;
  readonly worktree: string;
  readonly globalText: () => string;
  readonly stateText: () => string;
  cleanup(): Promise<void>;
}

export async function createHarness(
  options: {
    readonly secrets?: Readonly<Record<string, string>>;
    readonly admission?: HardwareAdmissionGate;
    readonly projectId?: string;
    readonly projectJobName?: string;
    readonly watchdogIntervalMs?: number;
    readonly readinessTimeoutMs?: number;
    readonly onPreviewRestart?: TestEnvOrchestratorOptions["onPreviewRestart"];
    readonly portLeases?: SqlitePortLeaseStore;
    readonly portProbe?: (port: number) => Promise<boolean>;
    readonly globalText?: () => string;
  } = {},
): Promise<TestHarness> {
  const projectId = options.projectId ?? "project-1";
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ef-env-data-"));
  const broker = options.portLeases
    ? null
    : GlobalBrokerDb.open({
        root,
        logger: quietBrokerLogger,
        now: () => 1,
      });
  let stateDb: ProjectStateDb | null = null;
  try {
    if (broker) {
      ensureBrokerProject(broker, {
        id: projectId,
        path: projectPath(root),
        displayName: "Demo",
        schemaVersion: 1,
        now: 1,
      });
    }
    stateDb = openProjectStateDb({
      projectId,
      rootDir: root,
      logger: quietStateLogger,
      now: () => 1,
    });
  } catch (error) {
    stateDb?.close();
    broker?.close();
    await fs.rm(root, { recursive: true, force: true });
    throw error;
  }
  const portLeases = options.portLeases ?? new SqlitePortLeaseStore(broker as GlobalBrokerDb);
  const envProcesses = new SqliteEnvProcessStore(stateDb);
  const jobs = new TrackingJobManager(envProcesses);
  const registry = new ServiceProviderRegistry();
  const providers = new Map<string, RecordingProvider>();
  for (const name of SERVICE_NAMES) {
    const provider = new RecordingProvider(name);
    providers.set(name, provider);
    registry.register(provider);
  }
  const worktree = await fs.mkdtemp(path.join(os.tmpdir(), "ef-env-"));
  const orchestrator = new TestEnvOrchestrator({
    projectId,
    portLeases,
    envProcesses,
    jobs,
    providers: registry,
    admission: options.admission,
    secrets: new MapSecretVault(options.secrets ?? { pg: "vault-secret-pg-value" }),
    ...(options.projectJobName ? { projectJobName: options.projectJobName } : {}),
    ...(options.watchdogIntervalMs !== undefined
      ? { watchdogIntervalMs: options.watchdogIntervalMs }
      : {}),
    ...(options.readinessTimeoutMs !== undefined
      ? { readinessTimeoutMs: options.readinessTimeoutMs }
      : {}),
    ...(options.onPreviewRestart ? { onPreviewRestart: options.onPreviewRestart } : {}),
    ...(options.portProbe ? { portProbe: options.portProbe } : {}),
  });
  return {
    orchestrator,
    portLeases,
    envProcesses,
    jobs,
    providers,
    worktree,
    globalText: options.globalText ?? (() => JSON.stringify(portLeases.list())),
    stateText: () => JSON.stringify(envProcesses.list()),
    async cleanup() {
      await fs.rm(worktree, { recursive: true, force: true });
      stateDb?.close();
      broker?.close();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

export function appManifest(script: string, extra = ""): string {
  return `services: [postgres, redis]
app:
  start: ${yamlCommand(script)}
  ready: http GET /api/health == 200
  memoryCeilingMb: 512
extraServices:
  worker:
    start: ${yamlCommand("health-server.mjs")}
    ready: http GET /ready == 200
env:
  PORT: "{port.app}"
  APP_URL: "http://{host}:{port.app}"
  DATABASE_URL: "postgres://app:{secret.pg}@127.0.0.1:{port.pg}/{db.name}"
${extra}`;
}

export async function holdPort(
  preferred = 41000,
): Promise<{ port: number; close(): Promise<void> }> {
  for (let port = preferred; port < preferred + 40; port += 1) {
    const server = net.createServer();
    const bound = await new Promise<boolean>((resolve) => {
      server.once("error", () => resolve(false));
      server.listen({ port, host: "127.0.0.1", exclusive: true }, () => resolve(true));
    });
    if (!bound) {
      server.close();
      continue;
    }
    return {
      port,
      close: () =>
        new Promise((resolve) => {
          server.close(() => resolve());
        }),
    };
  }
  throw new Error("could not hold a port in the test range");
}

export function spawnSleeper(): ChildProcess {
  return spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
    windowsHide: true,
  });
}

const quietBrokerLogger: AuxiliaryLogger = {
  warn() {
    return;
  },
};

const quietStateLogger: StateDbLogger = {
  info() {
    return;
  },
  warn() {
    return;
  },
  error() {
    return;
  },
};

function projectPath(root: string): string {
  return process.platform === "win32" ? "C:\\projects\\demo" : path.join(root, "checkout");
}

function killTree(pid: number): void {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if (!(error instanceof Error)) throw error;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error) return false;
    return false;
  }
}
