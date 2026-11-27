import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  ChildExitedBeforeReadyError,
  EnvironmentAdmissionDeniedError,
  EnvironmentDestroyedError,
  EnvironmentStateError,
  PortRangeExhaustedError,
  UnknownServiceError,
} from "./errors.js";
import { commandExecutable, splitCommandLine } from "./command.js";
import {
  createEnvironmentDirectories,
  environmentDirectories,
  removeDirectoryWithBusyRetry,
  removeStaleEnvironmentDirectories,
} from "./directories.js";
import { EnvironmentManifestSchema, parseEnvironmentKind } from "./manifest.js";
import { canBindPort, httpStatus, listeningPid, tcpConnectable } from "./net.js";
import type { ServiceProviderRegistry } from "./providers.js";
import { parseReadinessProbe, waitForReady, type ReadinessProbe } from "./readiness.js";
import {
  collectSecretValues,
  redactSecrets,
  resolveTemplates,
  runtimeVaultInjection,
  MapSecretVault,
} from "./secrets.js";
import { selectProvisioning } from "./tiers.js";
import {
  DEFAULT_READINESS_TIMEOUT_MS,
  IGNORED_APP_PORT,
  SERVICE_PORT_KEYS,
  admitAllEnvironments,
  type EnvProcessStore,
  type EnvironmentDirectories,
  type EnvironmentHandle,
  type EnvironmentKind,
  type EnvironmentManifest,
  type HardwareAdmissionGate,
  type JobHandle,
  type PortLeaseStore,
  type ProvisioningTier,
  type SecretVault,
  type ServiceName,
  type ServiceProvisionContext,
  type ServiceProvisionResult,
  type ServiceProvider,
  type StartupReconcileReport,
  type WindowsJobManager,
} from "./types.js";

interface TrackedChild {
  readonly pid: number;
  readonly startTime: number;
  readonly port: number | null;
  readonly child: ChildProcess;
  logs(): string;
  readonly exited: Promise<{ readonly code: number | null }>;
  kill(): void;
}

interface ProvisionedService {
  readonly provider: ServiceProvider;
  readonly context: ServiceProvisionContext;
  readonly result: ServiceProvisionResult;
}

interface StartedService {
  url: string;
  child: TrackedChild | null;
}

interface ManagedEnvironment {
  readonly id: string;
  readonly shortId: string;
  readonly kind: EnvironmentKind;
  readonly tier: ProvisioningTier;
  readonly host: string;
  readonly baseCommit: string;
  readonly worktreePath: string;
  readonly dbName: string;
  readonly recipientDomain: string;
  readonly manifest: EnvironmentManifest;
  readonly directories: EnvironmentDirectories;
  readonly ports: Record<string, number>;
  readonly urls: Record<string, string>;
  readonly varsResolved: Record<string, string>;
  readonly job: JobHandle;
  readonly provisioned: ProvisionedService[];
  readonly secretValues: readonly string[];
  app: TrackedChild | null;
  readonly services: Map<string, StartedService>;
  destroyPromise: Promise<void> | null;
  destroyed: boolean;
  watchdog: ReturnType<typeof setInterval> | null;
  restarting: boolean;
}

interface AcquiredResources {
  environmentId: string;
  directories: EnvironmentDirectories | null;
  job: JobHandle | null;
  provisioned: ProvisionedService[];
}

export interface PreviewRestartEvent {
  readonly environmentId: string;
  readonly memoryBytes: number;
  readonly ceilingMb: number;
}

export interface TestEnvOrchestratorOptions {
  readonly projectId: string;
  readonly portLeases: PortLeaseStore;
  readonly envProcesses: EnvProcessStore;
  readonly jobs: WindowsJobManager;
  readonly providers: ServiceProviderRegistry;
  readonly admission?: HardwareAdmissionGate;
  readonly secrets?: SecretVault;
  readonly projectJobName?: string;
  readonly now?: () => number;
  readonly idFactory?: () => { readonly id: string; readonly shortId: string };
  readonly portProbe?: (port: number) => Promise<boolean>;
  readonly readinessTimeoutMs?: number;
  readonly readinessIntervalMs?: number;
  readonly watchdogIntervalMs?: number;
  readonly externalPortSkipMs?: number;
  readonly onPreviewRestart?: (event: PreviewRestartEvent) => void;
}

const EMPTY_VAULT = new MapSecretVault();

export class TestEnvOrchestrator {
  private readonly live = new Map<string, ManagedEnvironment>();
  private readonly skippedUntil = new Map<number, number>();
  private readonly admission: HardwareAdmissionGate;
  private readonly secrets: SecretVault;

  constructor(private readonly options: TestEnvOrchestratorOptions) {
    this.admission = options.admission ?? admitAllEnvironments;
    this.secrets = options.secrets ?? EMPTY_VAULT;
  }

  async create(
    kind: EnvironmentKind | string,
    manifestInput: string | EnvironmentManifest | unknown,
    baseCommit: string,
    worktreePath: string,
  ): Promise<EnvironmentHandle> {
    const environmentKind = parseEnvironmentKind(kind);
    if (baseCommit.trim() === "") {
      throw new EnvironmentStateError("baseCommit is required");
    }
    if (worktreePath.trim() === "") {
      throw new EnvironmentStateError("worktreePath is required");
    }
    const manifest = EnvironmentManifestSchema.parse(manifestInput);
    const selection = selectProvisioning({ kind: environmentKind, manifest });
    if (selection.stateful) {
      const decision = await this.admission.admitEnvironment({
        projectId: this.options.projectId,
        kind: environmentKind,
        tier: selection.tier,
        services: selection.services,
        stateful: true,
      });
      if (!decision.admitted) {
        throw new EnvironmentAdmissionDeniedError(decision.reason);
      }
    }

    const identity = this.nextIdentity();
    const directories = environmentDirectories(worktreePath, identity.id);
    const acquired: AcquiredResources = {
      environmentId: identity.id,
      directories,
      job: null,
      provisioned: [],
    };

    try {
      await createEnvironmentDirectories(directories, {
        environmentId: identity.id,
        projectId: this.options.projectId,
        createdAt: this.now(),
      });
      const ceiling = manifest.app?.memoryCeilingMb;
      const job = this.options.jobs.createJob({
        name: `environment:${identity.id}`,
        kind: "environment",
        ...(this.options.projectJobName ? { parentName: this.options.projectJobName } : {}),
        limits: {
          killOnJobClose: true,
          activeProcessLimit: 64,
          ...(ceiling !== undefined ? { jobMemoryBytes: Math.round(ceiling * 1024 * 1024) } : {}),
        },
      });
      acquired.job = job;

      const ports: Record<string, number> = {};
      if (selection.allocateAppPort) {
        ports.app = await this.leaseOne(identity.id);
      }
      for (const service of selection.services) {
        const portKey = SERVICE_PORT_KEYS[service];
        if (portKey !== null) ports[portKey] = await this.leaseOne(identity.id);
      }
      if (selection.tier > 0 && manifest.extraServices) {
        for (const name of Object.keys(manifest.extraServices)) {
          ports[name] = await this.leaseOne(identity.id);
        }
      }

      const dbName = `env_${identity.shortId}`;
      const host = `env-${identity.shortId}.localhost`;
      const recipientDomain = `env-${identity.shortId}.test`;
      const placeholderValues: Record<string, string> = {
        host,
        "env.id": identity.id,
        "db.name": dbName,
      };
      for (const [key, port] of Object.entries(ports)) {
        placeholderValues[`port.${key}`] = String(port);
      }
      const varsResolved = resolveTemplates(manifest.env, placeholderValues, this.secrets);
      if (ports.app !== undefined && varsResolved.PORT === undefined) {
        varsResolved.PORT = String(ports.app);
      }

      const urls: Record<string, string> = {};
      for (const service of selection.services) {
        const portKey = SERVICE_PORT_KEYS[service];
        const port = portKey === null ? null : (ports[portKey] ?? null);
        const context: ServiceProvisionContext = {
          projectId: this.options.projectId,
          environmentId: identity.id,
          kind: environmentKind,
          tier: selection.tier,
          host,
          dbName,
          recipientDomain,
          port,
          portKey,
          directories,
          worktreePath,
          baseCommit,
        };
        const provider = this.options.providers.require(service);
        const result = await provider.provision(context);
        const provisioned = { provider, context, result };
        acquired.provisioned.push(provisioned);
        urls[service] = result.url ?? defaultServiceUrl(service, host, port, dbName, identity.id);
      }

      const state: ManagedEnvironment = {
        id: identity.id,
        shortId: identity.shortId,
        kind: environmentKind,
        tier: selection.tier,
        host,
        baseCommit,
        worktreePath,
        dbName,
        recipientDomain,
        manifest,
        directories,
        ports,
        urls,
        varsResolved,
        job,
        provisioned: acquired.provisioned,
        secretValues: collectSecretValues(this.secrets),
        app: null,
        services: new Map(),
        destroyPromise: null,
        destroyed: false,
        watchdog: null,
        restarting: false,
      };
      this.live.set(state.id, state);
      this.startWatchdog(state);
      return this.handleFor(state);
    } catch (error) {
      try {
        await this.rollback(acquired);
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], "environment create failed and rollback failed");
      }
      throw error;
    }
  }

  async reconcileOnStartup(input: {
    readonly liveEnvironmentIds: readonly string[];
    readonly workspaceRoots: readonly string[];
  }): Promise<StartupReconcileReport> {
    const live = new Set(input.liveEnvironmentIds);
    for (const id of this.live.keys()) {
      if (!this.live.get(id)?.destroyed) live.add(id);
    }
    const orphanReport = await this.options.jobs.reconcileOrphanedProcesses();
    let removedProcessRows = 0;
    for (const record of orphanReport.terminated) {
      this.options.envProcesses.delete(record.pid, record.startTime);
      removedProcessRows += 1;
    }
    for (const skip of orphanReport.skipped) {
      if (!skip.removeRecord) continue;
      this.options.envProcesses.delete(skip.record.pid, skip.record.startTime);
      removedProcessRows += 1;
    }
    const releasedPorts = this.options.portLeases.releaseLeasesForDeadEnvironments(live);
    const removedDirectories = await removeStaleEnvironmentDirectories(input.workspaceRoots, live);
    return { releasedPorts, removedProcessRows, removedDirectories, orphanReport };
  }

  private handleFor(state: ManagedEnvironment): EnvironmentHandle {
    return {
      id: state.id,
      shortId: state.shortId,
      kind: state.kind,
      tier: state.tier,
      host: state.host,
      baseCommit: state.baseCommit,
      worktreePath: state.worktreePath,
      dbName: state.dbName,
      recipientDomain: state.recipientDomain,
      ports: state.ports,
      urls: state.urls,
      directories: state.directories,
      vars: () => ({ ...state.varsResolved }),
      start_app: () => this.startApp(state),
      start_service: (name: string) => this.startService(state, name),
      reset_data: () => this.resetData(state),
      destroy: () => this.destroyEnvironment(state),
    };
  }

  private async startApp(state: ManagedEnvironment): Promise<void> {
    this.assertLive(state);
    const app = state.manifest.app;
    const port = state.ports.app;
    if (state.tier === 0 || app === undefined || port === undefined) {
      throw new EnvironmentStateError("this environment tier does not start an app server");
    }
    if (state.app) {
      throw new EnvironmentStateError("app is already running");
    }
    state.app = await this.launchProcess(state, {
      command: app.start,
      cwd: app.cwd ?? state.worktreePath,
      role: "app",
      portKey: "app",
      port,
      ready: app.ready,
      detectIgnoredPort: true,
    });
  }

  private async startService(state: ManagedEnvironment, name: string): Promise<string> {
    this.assertLive(state);
    const existing = state.services.get(name);
    if (existing) return existing.url;
    const extra = state.manifest.extraServices?.[name];
    if (extra) {
      if (state.tier === 0) {
        throw new EnvironmentStateError("tier 0 does not start services");
      }
      const port = state.ports[name];
      if (port === undefined) {
        throw new EnvironmentStateError(`no port leased for ${name}`);
      }
      const child = await this.launchProcess(state, {
        command: extra.start,
        cwd: extra.cwd ?? state.worktreePath,
        role: name,
        portKey: name,
        port,
        ready: extra.ready,
        detectIgnoredPort: false,
      });
      const assigned = state.ports[name] ?? port;
      const url = allocatedUrl(state.host, assigned, extra.ready);
      state.services.set(name, { url, child });
      state.urls[name] = url;
      return url;
    }
    const provisioned = state.provisioned.find((item) => item.provider.serviceName === name);
    if (!provisioned) throw new UnknownServiceError(name);
    const started = provisioned.provider.start
      ? await provisioned.provider.start(provisioned.context)
      : { url: provisioned.result.url ?? "" };
    const url = started.url || provisioned.result.url;
    if (!url) throw new EnvironmentStateError(`service ${name} has no url`);
    state.services.set(name, { url, child: null });
    state.urls[name] = url;
    return url;
  }

  private async resetData(state: ManagedEnvironment): Promise<void> {
    this.assertLive(state);
    for (const item of state.provisioned) {
      await item.provider.resetData(item.context);
    }
  }

  private destroyEnvironment(state: ManagedEnvironment): Promise<void> {
    if (!state.destroyPromise) {
      state.destroyPromise = this.performDestroy(state);
    }
    return state.destroyPromise;
  }

  private async performDestroy(state: ManagedEnvironment): Promise<void> {
    state.destroyed = true;
    if (state.watchdog) {
      clearInterval(state.watchdog);
      state.watchdog = null;
    }
    const children = [
      state.app,
      ...[...state.services.values()].map((service) => service.child),
    ].filter((child): child is TrackedChild => child !== null);
    const failures: unknown[] = [];
    await this.capture(failures, () => this.options.jobs.terminateJob(state.job));
    for (const child of children) {
      await this.capture(failures, () => this.stopChild(child));
    }
    await this.capture(failures, () => this.waitUntilQuiet(state.job));
    for (const item of [...state.provisioned].reverse()) {
      await this.capture(failures, () => item.provider.destroy(item.context));
    }
    await this.capture(failures, () => {
      this.options.envProcesses.deleteEnvironment(state.id);
    });
    await this.capture(failures, () => {
      this.options.portLeases.releaseEnvironment(state.id);
    });
    await this.capture(failures, () => removeDirectoryWithBusyRetry(state.directories.root));
    this.live.delete(state.id);
    if (failures.length > 0) {
      throw new AggregateError(failures, "environment destroy failed");
    }
  }

  private async rollback(acquired: AcquiredResources): Promise<void> {
    for (const item of [...acquired.provisioned].reverse()) {
      await item.provider.destroy(item.context);
    }
    if (acquired.job) await this.options.jobs.terminateJob(acquired.job);
    this.options.envProcesses.deleteEnvironment(acquired.environmentId);
    this.options.portLeases.releaseEnvironment(acquired.environmentId);
    if (acquired.directories) {
      await removeDirectoryWithBusyRetry(acquired.directories.root);
    }
    this.live.delete(acquired.environmentId);
  }

  private async launchProcess(
    state: ManagedEnvironment,
    input: {
      readonly command: string;
      readonly cwd: string;
      readonly role: string;
      readonly portKey: string;
      readonly port: number;
      readonly ready: string;
      readonly detectIgnoredPort: boolean;
    },
  ): Promise<TrackedChild> {
    let port = input.port;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const tracked = this.spawn(state, input.command, input.cwd, input.role, port);
      try {
        await this.awaitReady(state, tracked, input.ready, port, input.detectIgnoredPort);
        if (port !== input.port) {
          state.ports[input.portKey] = port;
          this.refreshVars(state);
        }
        return tracked;
      } catch (error) {
        await this.stopChild(tracked);
        const occupied =
          error instanceof ChildExitedBeforeReadyError && error.logs.includes("EADDRINUSE");
        if (!occupied || attempt === 7) throw error;
        this.options.portLeases.release(port, state.id);
        this.skippedUntil.set(port, this.now() + (this.options.externalPortSkipMs ?? 30_000));
        port = await this.leaseOne(state.id);
      }
    }
    throw new EnvironmentStateError(`could not bind a port for ${input.role}`);
  }

  private refreshVars(state: ManagedEnvironment): void {
    const values: Record<string, string> = {
      host: state.host,
      "env.id": state.id,
      "db.name": state.dbName,
    };
    for (const [key, port] of Object.entries(state.ports)) {
      values[`port.${key}`] = String(port);
    }
    const resolved = resolveTemplates(state.manifest.env, values, this.secrets);
    if (state.ports.app !== undefined && resolved.PORT === undefined) {
      resolved.PORT = String(state.ports.app);
    }
    for (const key of Object.keys(state.varsResolved)) {
      delete state.varsResolved[key];
    }
    Object.assign(state.varsResolved, resolved);
  }

  private spawn(
    state: ManagedEnvironment,
    command: string,
    cwd: string,
    role: string,
    port: number,
  ): TrackedChild {
    const parts = splitCommandLine(command);
    const file = parts[0];
    if (file === undefined) throw new EnvironmentStateError(`empty command for ${role}`);
    const args = parts.slice(1);
    const env = this.processEnv(state, port);
    const child = spawnCommand(file, args, cwd, env);
    if (child.pid === undefined) {
      throw new EnvironmentStateError(`failed to spawn ${role}`);
    }
    const pid = child.pid;
    const startTime = this.now();
    this.options.jobs.assignProcess(state.job, pid);
    this.options.envProcesses.insert({
      pid,
      startTime,
      environment: state.id,
      role,
      port,
      jobName: state.job.name,
    });
    let combined = "";
    const append = (chunk: Buffer | string) => {
      combined = `${combined}${chunk.toString()}`.slice(-64_000);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    const exited = new Promise<{ code: number | null }>((resolve) => {
      child.once("exit", (code) => resolve({ code }));
    });
    return {
      pid,
      startTime,
      port,
      child,
      logs: () => redactSecrets(combined, state.secretValues),
      exited,
      kill: () => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        child.kill();
      },
    };
  }

  private processEnv(state: ManagedEnvironment, port: number): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const key of ["PATH", "PATHEXT", "SystemRoot", "COMSPEC", "WINDIR", "PROGRAMFILES"]) {
      const value = process.env[key];
      if (value !== undefined) env[key] = value;
    }
    env.TEMP = state.directories.temp;
    env.TMP = state.directories.temp;
    for (const [key, value] of Object.entries(state.varsResolved)) env[key] = value;
    for (const [key, value] of Object.entries(runtimeVaultInjection(state.kind, this.secrets))) {
      if (env[key] === undefined) env[key] = value;
    }
    env.PORT = String(port);
    return env;
  }

  private async awaitReady(
    state: ManagedEnvironment,
    tracked: TrackedChild,
    ready: string,
    port: number,
    detectIgnoredPort: boolean,
  ): Promise<void> {
    const probe = parseReadinessProbe(ready);
    await waitForReady({
      timeoutMs: this.options.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS,
      intervalMs: this.options.readinessIntervalMs ?? 40,
      logs: () => tracked.logs(),
      exit: tracked.exited,
      expectedPort: port,
      ...(detectIgnoredPort
        ? { detectIgnoredPort: () => this.detectIgnoredAppPort(tracked.pid, port) }
        : {}),
      probe: () => this.runProbe(state, tracked, probe, port),
    });
  }

  private async runProbe(
    state: ManagedEnvironment,
    tracked: TrackedChild,
    probe: ReadinessProbe,
    port: number,
  ): Promise<boolean> {
    if (probe.type === "http") {
      const status = await httpStatus(port, probe.path, `${state.host}:${port}`, 400);
      if (status !== probe.status) return false;
      return this.listenerIsChild(port, tracked.pid);
    }
    if (probe.type === "tcp") {
      const open = await tcpConnectable(port, "127.0.0.1", 200);
      if (!open) return false;
      return this.listenerIsChild(port, tracked.pid);
    }
    return probe.pattern.test(tracked.logs());
  }

  private async listenerIsChild(port: number, pid: number): Promise<boolean> {
    if (process.platform !== "win32") return true;
    const listener = await listeningPid(port);
    return listener === pid;
  }

  private async detectIgnoredAppPort(pid: number, expectedPort: number): Promise<number | null> {
    if (expectedPort === IGNORED_APP_PORT) return null;
    const open = await tcpConnectable(IGNORED_APP_PORT, "127.0.0.1", 80);
    if (!open) return null;
    const listener = await listeningPid(IGNORED_APP_PORT);
    if (listener === pid) return IGNORED_APP_PORT;
    return null;
  }

  private async stopChild(tracked: TrackedChild): Promise<void> {
    tracked.kill();
    await Promise.race([tracked.exited, delay(1_000)]);
    this.options.envProcesses.delete(tracked.pid, tracked.startTime);
  }

  private async waitUntilQuiet(job: JobHandle): Promise<void> {
    const started = Date.now();
    for (;;) {
      let active = 0;
      try {
        active = this.options.jobs.queryJobAccounting(job).activeProcesses;
      } catch (error) {
        if (error instanceof Error) return;
        return;
      }
      if (active <= 0) return;
      if (Date.now() - started > 2_000) return;
      await delay(25);
    }
  }

  private startWatchdog(state: ManagedEnvironment): void {
    const ceiling = state.manifest.app?.memoryCeilingMb;
    if (state.kind !== "preview" || ceiling === undefined) return;
    const intervalMs = this.options.watchdogIntervalMs ?? 5_000;
    state.watchdog = setInterval(() => {
      void this.checkMemory(state, ceiling);
    }, intervalMs);
    state.watchdog.unref?.();
  }

  private async checkMemory(state: ManagedEnvironment, ceilingMb: number): Promise<void> {
    if (state.destroyed || state.restarting || state.app === null) return;
    let memoryBytes = 0;
    try {
      memoryBytes = this.options.jobs.queryJobAccounting(state.job).currentMemoryBytes;
    } catch (error) {
      if (error instanceof Error) return;
      return;
    }
    if (memoryBytes <= ceilingMb * 1024 * 1024) return;
    state.restarting = true;
    try {
      const previous = state.app;
      state.app = null;
      if (previous) await this.stopChild(previous);
      if (state.destroyed) return;
      await this.startApp(state);
      this.options.onPreviewRestart?.({
        environmentId: state.id,
        memoryBytes,
        ceilingMb,
      });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
    } finally {
      state.restarting = false;
    }
  }

  private async leaseOne(environmentId: string): Promise<number> {
    const now = this.now();
    const skip = new Set<number>();
    for (const [port, until] of this.skippedUntil) {
      if (until <= now) this.skippedUntil.delete(port);
      else skip.add(port);
    }
    const probe = this.options.portProbe ?? canBindPort;
    for (;;) {
      const port = this.options.portLeases.leaseNext({
        projectId: this.options.projectId,
        environmentId,
        leasedAt: now,
        expiresAt: null,
        skip,
      });
      if (port === null) throw new PortRangeExhaustedError();
      if (port < 41000 || port > 48999) {
        this.options.portLeases.release(port, environmentId);
        throw new PortRangeExhaustedError();
      }
      const free = await probe(port);
      if (free) return port;
      this.options.portLeases.release(port, environmentId);
      skip.add(port);
      this.skippedUntil.set(port, now + (this.options.externalPortSkipMs ?? 30_000));
    }
  }

  private nextIdentity(): { id: string; shortId: string } {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const identity = this.options.idFactory ? this.options.idFactory() : defaultIdentity();
      const collision = [...this.live.values()].some(
        (environment) => environment.id === identity.id || environment.shortId === identity.shortId,
      );
      if (!collision) return identity;
    }
    throw new EnvironmentStateError("could not allocate a unique environment id");
  }

  private assertLive(state: ManagedEnvironment): void {
    if (state.destroyed) throw new EnvironmentDestroyedError(state.id);
  }

  private now(): number {
    return this.options.now ? this.options.now() : Date.now();
  }

  private async capture(failures: unknown[], step: () => Promise<void> | void): Promise<void> {
    try {
      await step();
    } catch (error) {
      failures.push(error);
    }
  }
}

function defaultIdentity(): { id: string; shortId: string } {
  const shortId = randomBytes(4).toString("hex");
  return { id: `env_${shortId}${randomBytes(2).toString("hex")}`, shortId };
}

function defaultServiceUrl(
  service: ServiceName,
  host: string,
  port: number | null,
  dbName: string,
  environmentId: string,
): string {
  if (service === "sqlite" || port === null) return `file://${dbName}`;
  if (service === "postgres") return `postgres://127.0.0.1:${port}/${dbName}`;
  if (service === "redis") return `redis://127.0.0.1:${port}/0`;
  if (service === "mail") return `smtp://127.0.0.1:${port}`;
  if (service === "oauth") return `http://127.0.0.1:${port}/${environmentId}`;
  return `http://${host}:${port}`;
}

function allocatedUrl(host: string, port: number, ready: string): string {
  const probe = parseReadinessProbe(ready);
  if (probe.type === "tcp") return `tcp://${host}:${port}`;
  return `http://${host}:${port}`;
}

function spawnCommand(
  file: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): ChildProcess {
  const stdio: ["ignore", "pipe", "pipe"] = ["ignore", "pipe", "pipe"];
  if (!useWindowsShell(file)) {
    return spawn(commandExecutable(file), [...args], {
      cwd,
      env,
      stdio,
      windowsHide: true,
    });
  }
  const commandLine = [file, ...args].map(quoteWindowsArg).join(" ");
  return spawn(commandLine, {
    cwd,
    env,
    stdio,
    windowsHide: true,
    shell: true,
  });
}

function useWindowsShell(file: string): boolean {
  if (process.platform !== "win32") return false;
  if (file.includes("\\") || file.includes("/") || /^[A-Za-z]:/.test(file)) return false;
  const base = file.toLowerCase();
  return base !== "node" && base !== "node.exe";
}

function quoteWindowsArg(value: string): string {
  if (value.length === 0) return '""';
  if (!/[\s"&]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
