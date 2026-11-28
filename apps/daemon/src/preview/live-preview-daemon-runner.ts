import path from "node:path";
import { featureUpdatePill } from "./preview-partition.js";
import { HEALTH_PROBE_FAIL_MS } from "./timings.js";
import type {
  CliResult,
  HardwarePressure,
  LivePreviewDeps,
  MergeRefreshResult,
  PreviewReloadSignal,
  PreviewSnapshot,
  SendErrorToFixRequest,
  SupervisedProcess,
  TeardownReport,
} from "./ports.js";

export type { CliResult, MergeRefreshResult, PreviewSnapshot, SendErrorToFixRequest, TeardownReport };

interface BootOptions {
  readonly allowFallback: boolean;
  readonly reusePort: boolean;
  readonly isFallback: boolean;
}

type Probe =
  | { readonly ok: true; readonly elapsedMs: number }
  | {
      readonly ok: false;
      readonly elapsedMs: number;
      readonly reason: "exit_nonzero" | "health_timeout" | "startup_crash";
    };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function probeStatus(url: string): Promise<{ status: number; sha: string } | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(200) });
    return { status: response.status, sha: response.headers.get("x-ef-preview-sha") ?? "" };
  } catch {
    return null;
  }
}

function normalizeRoute(route: string | undefined): string {
  const value = route ?? "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("://") || value.includes("\\")) {
    throw new Error("preview route must be an in-app path");
  }
  return value;
}

/**
 * Runs the built app from the persistent `wt/<project>/integration` checkout
 * on a leased loopback port, and only after Preview is actually opened.
 */
export class LivePreviewDaemonRunner {
  private state: PreviewSnapshot["state"] = "idle";
  private mode: PreviewSnapshot["mode"] = null;
  private sha: string;
  private port: number | null = null;
  private dbPort: number | null = null;
  private jobId: string | null = null;
  private pid: number | null = null;
  private pathName = "/";
  private pill: string | null = null;
  private banner: string | null = null;
  private stderrRedacted: string | null = null;
  private failedSha: string | null = null;
  private everStarted = false;
  private quit = false;
  private tornDown: TeardownReport | null = null;
  private openedBy: "tab" | "pop-out" | null = null;
  private hiddenTimer: { cancel(): void } | null = null;

  constructor(private readonly deps: LivePreviewDeps) {
    this.sha = deps.headSha;
  }

  async openPreview(input?: { readonly reason?: "tab" | "pop-out"; readonly path?: string }): Promise<PreviewSnapshot> {
    if (this.quit) throw new Error("preview runner has quit");
    this.openedBy = input?.reason ?? "tab";
    this.deps.guard.assertPreviewSecrets(this.deps.secrets);
    if (input?.path !== undefined) this.pathName = normalizeRoute(input.path);
    if (this.state === "running") return this.snapshot();
    if (this.state === "suspended") return this.wake();
    this.everStarted = true;
    if (this.deps.target.kind === "cli") {
      await this.deps.worktrees.materialize(this.sha);
      this.deps.demo.ensureSeeded();
      this.state = "running";
      this.mode = "cli";
      return this.snapshot();
    }
    await this.boot(this.sha, { allowFallback: true, reusePort: false, isFallback: false });
    return this.snapshot();
  }

  noteHeadlessElapsed(elapsedMs: number): {
    readonly ramBytes: 0;
    readonly cpuPercent: 0;
    readonly serverProcesses: 0;
    readonly elapsedMs: number;
  } {
    if (this.everStarted) {
      throw new Error("headless footprint applies only before Preview is opened");
    }
    return { ramBytes: 0, cpuPercent: 0, serverProcesses: 0, elapsedMs };
  }

  markHidden(): void {
    this.hiddenTimer?.cancel();
    this.hiddenTimer = null;
    if (this.state !== "running") return;
    this.hiddenTimer = this.deps.scheduler.schedule(this.deps.timings.hiddenSuspendMs, async () => {
      await this.suspend();
    });
  }

  markShown(): void {
    this.hiddenTimer?.cancel();
    this.hiddenTimer = null;
  }

  async wake(): Promise<PreviewSnapshot> {
    if (this.quit) throw new Error("preview runner has quit");
    if (this.state === "running") return this.snapshot();
    this.everStarted = true;
    if (this.mode === "cli" || this.deps.target.kind === "cli") {
      this.deps.demo.ensureSeeded();
      this.state = "running";
      this.mode = "cli";
      return this.snapshot();
    }
    await this.boot(this.sha, {
      allowFallback: true,
      reusePort: this.port !== null,
      isFallback: false,
    });
    return this.snapshot();
  }

  async applyPressure(level: HardwarePressure): Promise<void> {
    if (level !== "RED" || this.state !== "running") return;
    await this.suspend();
  }

  async onPreviewReload(event: PreviewReloadSignal): Promise<MergeRefreshResult> {
    if (this.quit) throw new Error("preview runner has quit");
    if (event.kind !== "preview-reload" || event.restartPreview !== true) {
      throw new Error("preview reload signal is invalid");
    }
    const featureId = event.featureIds[0];
    if (!featureId) throw new Error("preview reload requires a feature id");
    const migrations = event.migrations ?? [];
    this.deps.demo.assertCanApply(migrations);
    const pill = featureUpdatePill(featureId);
    const schemaChanged = event.schemaChanged === true || migrations.length > 0;
    const configChanged = event.configChanged === true;
    if (!this.everStarted || this.state === "idle") {
      if (migrations.length > 0) {
        this.deps.demo.ensureSeeded();
        this.deps.demo.applyAdditiveMigrations(migrations);
      }
      await this.deps.worktrees.noteHead(event.integrationSha);
      this.sha = event.integrationSha;
      this.pill = pill;
      return this.mergeResult("deferred");
    }
    if (!schemaChanged && !configChanged && this.state === "running" && this.mode === "web") {
      await this.deps.worktrees.noteHead(event.integrationSha);
      this.sha = event.integrationSha;
      this.pill = pill;
      return this.mergeResult("hmr");
    }
    if (this.state === "running") await this.stopProcessKeepLease();
    if (migrations.length > 0) {
      this.deps.demo.ensureSeeded();
      this.deps.demo.applyAdditiveMigrations(migrations);
    }
    this.pill = pill;
    if (this.mode === "cli") {
      await this.deps.worktrees.noteHead(event.integrationSha);
      this.sha = event.integrationSha;
      this.state = "running";
      return this.mergeResult("restart");
    }
    await this.boot(event.integrationSha, {
      allowFallback: true,
      reusePort: this.port !== null,
      isFallback: false,
    });
    return this.mergeResult(this.mergeRefreshMode(event.integrationSha));
  }

  async resetDemoData(): Promise<{ readonly elapsedMs: number; readonly reloaded: true }> {
    if (this.quit) throw new Error("preview runner has quit");
    const started = Date.now();
    const resumeWeb = this.state === "running" && this.mode === "web";
    const keepServerHot = resumeWeb && this.deps.engine === "sqlite";
    if (resumeWeb && !keepServerHot) await this.stopProcessKeepLease();
    this.deps.demo.resetDemoData();
    if (resumeWeb && !keepServerHot) {
      await this.boot(this.sha, { allowFallback: true, reusePort: this.port !== null, isFallback: false });
    }
    return { elapsedMs: Date.now() - started, reloaded: true };
  }

  async runCli(args: readonly string[]): Promise<CliResult> {
    if (this.quit) throw new Error("preview runner has quit");
    if (this.mode !== "cli" || this.state !== "running") throw new Error("CLI preview is not awake");
    const argv = [...this.deps.target.args, ...args];
    const checkout = await this.deps.worktrees.materialize(this.sha);
    this.assertIntegration(checkout.worktreePath);
    const prepared = this.deps.env.prepare({
      command: this.deps.target.command,
      args: argv,
      secrets: this.deps.secrets,
      extras: {
        DEMO_DB: this.deps.demo.databaseFile(),
        DATABASE_URL: this.deps.demo.connectionString(null),
      },
    });
    const job = await this.deps.jobs.spawn({
      command: this.deps.target.command,
      args: prepared.argv,
      cwd: checkout.worktreePath,
      env: prepared.env,
    });
    const result = await job.exited;
    await this.deps.jobs.terminate(job.jobId);
    return {
      exitCode: result.code,
      stdout: this.deps.env.redact(result.stdout),
      stderr: this.deps.env.redact(result.stderr),
    };
  }

  sendErrorToFix(): SendErrorToFixRequest | null {
    if (!this.banner || this.stderrRedacted === null) return null;
    const commitSha = this.failedSha ?? this.sha;
    if (commitSha.length === 0) return null;
    return {
      task: 161,
      type: "send-error-to-fix",
      projectId: this.deps.projectId,
      commitSha,
      stderrRedacted: this.stderrRedacted,
    };
  }

  async closeProject(): Promise<TeardownReport> {
    return this.teardown("project-switch");
  }

  async quitHarness(): Promise<TeardownReport> {
    return this.teardown("quit");
  }

  snapshot(): PreviewSnapshot {
    const origin = this.port === null ? null : `http://127.0.0.1:${this.port}`;
    const running = this.pid !== null;
    return {
      state: this.state,
      mode: this.mode,
      port: this.port,
      dbPort: this.dbPort,
      pid: this.pid,
      commitSha: this.everStarted ? this.sha : null,
      worktreePath: this.everStarted ? this.deps.worktrees.integrationPath() : null,
      origin,
      url: origin === null ? null : `${origin}${this.pathName === "/" ? "/" : this.pathName}`,
      path: this.pathName,
      pill: this.pill,
      banner: this.banner,
      stderrRedacted: this.stderrRedacted,
      everStarted: this.everStarted,
      serverProcesses: running ? 1 : 0,
      ramBytes: running ? 1 : 0,
      cpuPercent: running ? 1 : 0,
      leakedPids: this.deps.jobs.leakedPids(),
      databaseName: this.deps.demo.databaseName(),
      openedBy: this.openedBy,
    };
  }

  private async boot(sha: string, options: BootOptions): Promise<void> {
    const checkout = await this.deps.worktrees.materialize(sha);
    this.assertIntegration(checkout.worktreePath);
    this.deps.demo.ensureSeeded();
    if (!options.reusePort || this.port === null) {
      const lease = await this.deps.ports.lease({
        projectId: this.deps.projectId,
        environment: "preview",
        purpose: "live-preview",
      });
      this.port = lease.port;
      if (this.deps.engine === "postgres" && this.dbPort === null) {
        const dbLease = await this.deps.ports.lease({
          projectId: this.deps.projectId,
          environment: "preview",
          purpose: "preview-db",
        });
        this.dbPort = dbLease.port;
      }
    }
    if (this.port === null) throw new Error("preview port was not leased");
    await this.deps.ports.releaseHolder(this.port);
    if (this.dbPort !== null) {
      await this.deps.ports.releaseHolder(this.dbPort);
      await this.deps.demo.startEndpoint(this.dbPort);
    }
    const prepared = this.deps.env.prepare({
      command: this.deps.target.command,
      args: this.deps.target.args,
      secrets: this.deps.secrets,
      extras: {
        PORT: String(this.port),
        DEMO_DB: this.deps.demo.databaseFile(),
        DATABASE_URL: this.deps.demo.connectionString(this.dbPort),
        EF_PREVIEW_SHA: sha,
      },
    });
    const job = await this.deps.jobs.spawn({
      command: this.deps.target.command,
      args: prepared.argv,
      cwd: checkout.worktreePath,
      env: prepared.env,
    });
    this.jobId = job.jobId;
    this.pid = job.pid;
    this.sha = sha;
    this.mode = "web";
    const started = Date.now();
    const hasLastGood = this.deps.fallback.current(this.deps.projectId) !== null;
    const healthProbeMs =
      options.isFallback || !hasLastGood
        ? Math.max(this.deps.timings.healthProbeFailMs, HEALTH_PROBE_FAIL_MS)
        : this.deps.timings.healthProbeFailMs;
    const probe = await this.waitForHealth(this.port, job, started, sha, healthProbeMs);
    if (probe.ok) {
      this.deps.fallback.recordHealthy({
        projectId: this.deps.projectId,
        sha,
        httpStatus: 200,
        startupCrashes: 0,
        bootMs: probe.elapsedMs,
      });
      if (!options.isFallback) {
        this.banner = null;
        this.stderrRedacted = null;
        this.failedSha = null;
      }
      this.state = "running";
      return;
    }
    const stderr = job.stderr();
    await this.stopJob();
    if (!options.isFallback) {
      const plan = this.deps.fallback.planFailure({
        projectId: this.deps.projectId,
        attemptedSha: sha,
        detectedWithinMs: probe.elapsedMs,
        stderr,
        reason: probe.reason,
        redact: (text) => this.deps.env.redact(text),
      });
      this.banner = plan.banner;
      this.stderrRedacted = plan.stderrRedacted;
      this.failedSha = sha;
      if (options.allowFallback && plan.restoreSha) {
        await this.boot(plan.restoreSha, { allowFallback: false, reusePort: true, isFallback: true });
        return;
      }
    }
    await this.releasePorts();
    this.state = "failed";
  }

  private async waitForHealth(
    port: number,
    job: SupervisedProcess,
    started: number,
    sha: string,
    healthProbeFailMs = this.deps.timings.healthProbeFailMs,
  ): Promise<Probe> {
    const deadline = started + healthProbeFailMs;
    const url = `http://127.0.0.1:${port}/`;
    while (Date.now() < deadline) {
      const exit = job.poll();
      if (exit) return this.exitProbe(started);
      const status = await probeStatus(url);
      if (job.poll()) return this.exitProbe(started);
      if (status?.status === 200 && status.sha === sha) return { ok: true, elapsedMs: Date.now() - started };
      await delay(20);
    }
    if (job.poll()) return this.exitProbe(started);
    return { ok: false, elapsedMs: Date.now() - started, reason: "health_timeout" };
  }

  private exitProbe(started: number): Probe {
    const elapsedMs = Date.now() - started;
    return {
      ok: false,
      elapsedMs,
      reason: elapsedMs <= this.deps.timings.healthyBootWindowMs ? "startup_crash" : "exit_nonzero",
    };
  }

  private async suspend(): Promise<void> {
    this.hiddenTimer?.cancel();
    this.hiddenTimer = null;
    if (this.state !== "running") return;
    await this.stopProcessKeepLease();
    this.state = "suspended";
  }

  private async stopJob(): Promise<void> {
    if (!this.jobId) return;
    const jobId = this.jobId;
    this.jobId = null;
    this.pid = null;
    await this.deps.jobs.terminate(jobId);
  }

  private async stopProcessKeepLease(): Promise<void> {
    await this.stopJob();
    await this.deps.demo.stopEndpoint();
    if (this.port !== null) await this.deps.ports.hold(this.port);
    if (this.dbPort !== null) await this.deps.ports.hold(this.dbPort);
  }

  private async releasePorts(): Promise<void> {
    await this.deps.demo.stopEndpoint();
    if (this.port !== null) {
      const port = this.port;
      this.port = null;
      await this.deps.ports.release(port);
    }
    if (this.dbPort !== null) {
      const port = this.dbPort;
      this.dbPort = null;
      await this.deps.ports.release(port);
    }
  }

  private async teardown(reason: TeardownReport["reason"]): Promise<TeardownReport> {
    if (this.tornDown) return this.tornDown;
    this.hiddenTimer?.cancel();
    this.hiddenTimer = null;
    await this.stopJob();
    await this.releasePorts();
    const leasedPorts = this.deps.ports.list().filter((lease) => lease.projectId === this.deps.projectId).length;
    this.deps.demo.close();
    await this.deps.jobs.close();
    await this.deps.shutdown?.();
    this.state = "stopped";
    this.quit = true;
    this.pid = null;
    this.tornDown = {
      reason,
      leakedPids: this.deps.jobs.leakedPids(),
      leasedPorts,
    };
    return this.tornDown;
  }

  private mergeRefreshMode(integrationSha: string): MergeRefreshResult["mode"] {
    if (this.state === "running" && this.sha === integrationSha) return "restart";
    if (this.state === "running" && this.sha !== integrationSha) return "fallback";
    if (this.banner !== null && this.sha !== integrationSha) return "fallback";
    return this.sha === integrationSha ? "restart" : "fallback";
  }

  private mergeResult(mode: MergeRefreshResult["mode"]): MergeRefreshResult {
    return {
      mode,
      pill: this.pill ?? "",
      path: this.pathName,
      commitSha: this.sha,
      pid: this.pid,
      banner: this.banner,
      state: this.state,
    };
  }

  private assertIntegration(cwd: string): void {
    if (!cwd.endsWith(`${path.sep}integration`)) {
      throw new Error("preview server must run from wt/<project>/integration");
    }
  }
}
