import fs from "node:fs/promises";
import path from "node:path";
import { emitDenial, emitLatency, LaunchLatencyTracker } from "./audit.js";
import {
  DEFAULT_ACTIVE_PROCESS_LIMIT,
  DEFAULT_COMMAND_TIMEOUT_MS,
  DEFAULT_JOB_MEMORY_BYTES,
  VENDOR_TOKEN_ENV,
} from "./constants.js";
import { MxcCommandTimeoutError, MxcForegroundExitError, MxcModeError, MxcPoolError, SandboxUnavailableError } from "./errors.js";
import { buildScrubbedEnvironment, cacheLayout, injectSingleVendorToken } from "./env.js";
import { createNodeSpawner, createPinnedHelperBackend } from "./kernel.js";
import { assertSafeTempDir } from "./paths.js";
import { compileMxcPolicy, evaluateAccess, sealPolicyAtStart } from "./policy.js";
import { probeMxcAvailability, resolveHelperPath } from "./probe.js";
import type {
  AccessDecision,
  AccessKind,
  CommandResult,
  CommandSpec,
  CompiledMxcPolicy,
  DenialAuditEvent,
  JobHandle,
  MxcAvailability,
  MxcKernelBackend,
  MxcKernelLaunchResult,
  ProcessSpawner,
  SandboxAuditLogger,
  SandboxGovernorSink,
  SandboxInstance,
  SandboxLaunchSpec,
  SandboxTierProvider,
  TierCapabilityFlags,
  TierProbeResult,
  WindowsJobManagerPort,
  WrappedProcessHandle,
  WrappedProcessSpec,
} from "./types.js";
import { TIER_A_CAPABILITIES } from "./types.js";

export interface TierAMxcProviderOptions {
  readonly jobManager: WindowsJobManagerPort;
  readonly logger: SandboxAuditLogger;
  readonly governor: SandboxGovernorSink;
  readonly kernel?: MxcKernelBackend;
  readonly allowTestKernel?: boolean;
  readonly spawner?: ProcessSpawner;
  readonly helperPath?: string;
  readonly poolSize?: number;
  readonly probe?: () => Promise<MxcAvailability>;
  readonly clock?: () => number;
}

export class WarmMxcInstance implements SandboxInstance {
  readonly tier = "A" as const;
  generation = 0;
  attemptId: string | null = null;
  tempDir: string | null = null;
  policy: CompiledMxcPolicy | null = null;
  spec: SandboxLaunchSpec | null = null;
  job: JobHandle | null = null;

  constructor(readonly id: string) {}
}

export class TierAMxcProvider implements SandboxTierProvider {
  readonly tier = "A" as const;
  readonly capabilities: TierCapabilityFlags = TIER_A_CAPABILITIES;
  readonly kernelKind: "pinned_helper" | "test_double";
  private readonly instances: WarmMxcInstance[] = [];
  private readonly busy = new Set<string>();
  private readonly latencies = new LaunchLatencyTracker();
  private readonly jobManager: WindowsJobManagerPort;
  private readonly logger: SandboxAuditLogger;
  private readonly governor: SandboxGovernorSink;
  private readonly kernel: MxcKernelBackend;
  private readonly poolSize: number;
  private readonly readProbe: () => Promise<MxcAvailability>;
  private readonly clock: () => number;
  private jobSequence = 0;

  constructor(options: TierAMxcProviderOptions) {
    if (options.kernel?.kind === "test_double" && options.allowTestKernel !== true) {
      throw new MxcModeError("test_kernel_forbidden", "A test kernel cannot be the production MXC launcher");
    }
    const helperPath = resolveHelperPath(options.helperPath);
    this.jobManager = options.jobManager;
    this.logger = options.logger;
    this.governor = options.governor;
    this.kernel =
      options.kernel ??
      createPinnedHelperBackend({
        helperPath,
        spawner: options.spawner ?? createNodeSpawner(),
      });
    this.kernelKind = this.kernel.kind;
    this.poolSize = options.poolSize ?? 2;
    if (!Number.isInteger(this.poolSize) || this.poolSize < 1) {
      throw new MxcModeError("invalid_pool_size", "Warm pool size must be a positive integer");
    }
    this.readProbe = options.probe ?? (() => probeMxcAvailability(helperPath ? { helperPath } : {}));
    this.clock = options.clock ?? (() => performance.now());
  }

  async probe(): Promise<TierProbeResult> {
    const availability = await this.readProbe();
    return { tier: "A", capabilities: this.capabilities, ...availability };
  }

  async acquireWarmInstance(spec: SandboxLaunchSpec): Promise<SandboxInstance> {
    let instance = this.instances.find((item) => !this.busy.has(item.id));
    if (!instance) {
      if (this.instances.length >= this.poolSize) throw new MxcPoolError(this.poolSize);
      instance = new WarmMxcInstance(`mxc-${this.instances.length + 1}`);
      this.instances.push(instance);
    }
    await this.bind(instance, spec);
    this.busy.add(instance.id);
    return instance;
  }

  async executeCommand(instance: SandboxInstance, cmdSpec: CommandSpec): Promise<CommandResult> {
    const warm = this.requireWarm(instance);
    this.rejectBackground(cmdSpec);
    if (!warm.spec || !warm.policy || warm.policy.mode !== "per_command") {
      throw new MxcModeError("mode_mismatch", "executeCommand requires a per-command warm instance");
    }
    return this.run(warm, cmdSpec.command, cmdSpec.args ?? [], cmdSpec.timeoutMs, null);
  }

  async spawnWrappedProcess(spec: WrappedProcessSpec): Promise<WrappedProcessHandle> {
    if (spec.vendor === "gemini" && spec.token !== undefined) {
      throw new MxcModeError(
        "file_login_vendor_rejects_injected_token",
        "Gemini CLI login is read in place and does not take an injected token",
      );
    }
    if (VENDOR_TOKEN_ENV[spec.vendor] && (spec.token === undefined || spec.token.length === 0)) {
      throw new MxcModeError("wrapped_vendor_token_required", `Wrapped ${spec.vendor} requires its single scoped token`);
    }
    const instance = await this.acquireWarmInstance({ ...spec, mode: "wrapped", vendor: spec.vendor });
    const warm = this.requireWarm(instance);
    try {
      const result = await this.run(warm, spec.command, spec.args ?? [], spec.timeoutMs, spec.token ?? null);
      return {
        instance: warm,
        pid: result.pid,
        vendor: spec.vendor,
        providerHosts: warm.policy?.network.providerHosts ?? [],
        enforcement: result.enforcement,
      };
    } catch (error) {
      try {
        await this.disposeInstance(warm);
      } catch (cleanupError) {
        this.logger.write({
          ts: new Date().toISOString(),
          level: "error",
          component: "tier-a-mxc",
          msg: "warm instance cleanup failed",
          fields: {
            attemptId: spec.attemptId,
            detail: cleanupError instanceof Error ? cleanupError.name : "cleanup_failed",
          },
        });
      }
      throw error;
    }
  }

  async disposeInstance(instance: SandboxInstance): Promise<void> {
    const warm = this.requireWarm(instance);
    if (warm.job) {
      await this.jobManager.terminateJob(warm.job, "dispose");
      await warm.job.close();
      warm.job = null;
    }
    if (warm.spec && warm.tempDir) {
      assertSafeTempDir(warm.tempDir, {
        worktree: warm.spec.worktree,
        developerCheckout: warm.spec.developerCheckout,
      });
      await wipeDirectory(warm.tempDir);
    }
    warm.attemptId = null;
    warm.tempDir = null;
    warm.policy = null;
    warm.spec = null;
    this.busy.delete(warm.id);
  }

  checkAccess(instance: SandboxInstance, target: string, access: AccessKind): AccessDecision {
    const warm = this.requireWarm(instance);
    if (!warm.policy || !warm.attemptId) {
      throw new MxcModeError("instance_unbound", "Warm instance is not bound to an attempt");
    }
    const decision = evaluateAccess(warm.policy, target, access);
    if (!decision.allowed && decision.errno) {
      const event: DenialAuditEvent = {
        type: "sandbox_denial",
        tier: "A",
        attemptId: warm.attemptId,
        target,
        access,
        errno: decision.errno,
        ruleId: decision.ruleId,
        source: "policy",
      };
      emitDenial(this.logger, this.governor, event);
    }
    return decision;
  }

  private async bind(instance: WarmMxcInstance, spec: SandboxLaunchSpec): Promise<void> {
    const previousTemp = instance.tempDir;
    const previousSpec = instance.spec;
    const policy = compileMxcPolicy(spec);
    if (previousTemp && previousSpec) {
      assertSafeTempDir(previousTemp, {
        worktree: previousSpec.worktree,
        developerCheckout: previousSpec.developerCheckout,
      });
      await wipeDirectory(previousTemp);
    }
    const tempDir = assertSafeTempDir(spec.tempDir, {
      worktree: spec.worktree,
      developerCheckout: spec.developerCheckout,
    });
    await wipeDirectory(tempDir);
    instance.spec = spec;
    instance.policy = policy;
    instance.attemptId = spec.attemptId;
    instance.tempDir = tempDir;
    instance.generation += 1;
  }

  private async run(
    instance: WarmMxcInstance,
    command: string,
    args: readonly string[],
    timeoutMs: number | undefined,
    token: string | null | undefined,
  ): Promise<CommandResult> {
    if (command.length === 0 || command.includes("\0")) {
      throw new MxcModeError("invalid_command", "Command must be a direct executable path");
    }
    const spec = instance.spec;
    const compiled = instance.policy;
    if (!spec || !compiled || !instance.tempDir) {
      throw new MxcModeError("instance_unbound", "Warm instance is not bound to an attempt");
    }
    const started = this.clock();
    const sealed = sealPolicyAtStart(compiled, new Date().toISOString());
    instance.policy = sealed;
    await wipeDirectory(instance.tempDir);
    const redirects = cacheLayout(instance.tempDir, spec.proxyPort);
    await fs.mkdir(redirects.home, { recursive: true });
    await fs.mkdir(redirects.xdgCache, { recursive: true });
    await fs.mkdir(redirects.npmCache, { recursive: true });
    await fs.mkdir(redirects.eslintCache, { recursive: true });
    await fs.mkdir(redirects.vitestCache, { recursive: true });
    await fs.mkdir(redirects.turboCache, { recursive: true });
    await fs.mkdir(redirects.playwrightCache, { recursive: true });
    let env = buildScrubbedEnvironment(readNamedBaseline(), redirects);
    if (token && spec.vendor) env = injectSingleVendorToken(env, spec.vendor, token);
    if (this.kernel.kind !== "test_double") {
      const availability = await this.readProbe();
      if (!availability.launchable) {
        this.noteLatency(spec.attemptId, this.clock() - started);
        throw new SandboxUnavailableError(availability.launchBlocker ?? "mxc_requires_pinned_helper");
      }
    }
    const job = await this.jobManager.createJob(`tier-a-${spec.attemptId}-${++this.jobSequence}`, {
      killOnJobClose: true,
      uiRestrictions: true,
      jobMemoryBytes: spec.jobMemoryBytes ?? DEFAULT_JOB_MEMORY_BYTES,
      activeProcessLimit: spec.activeProcessLimit ?? DEFAULT_ACTIVE_PROCESS_LIMIT,
    });
    instance.job = job;
    const seenPids = new Set<number>();
    const assignStarted = (pid: number): Promise<void> => {
      if (!Number.isInteger(pid) || pid <= 0 || seenPids.has(pid)) return Promise.resolve();
      seenPids.add(pid);
      return this.jobManager.assignProcess(job, pid);
    };
    const timeout = timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    const controller = new AbortController();
    let settleTimer: (value: "timeout" | "cancel") => void = () => undefined;
    const timer = setTimeout(() => {
      controller.abort();
      settleTimer("timeout");
    }, timeout);
    timer.unref?.();
    const timeoutResult = new Promise<"timeout" | "cancel">((resolve) => {
      settleTimer = resolve;
    });
    const launchPromise = this.kernel
      .launch(
        {
          command,
          args,
          cwd: path.resolve(spec.worktree),
          env,
          policy: sealed,
          tempDir: instance.tempDir,
          attemptId: spec.attemptId,
          mode: sealed.mode,
          stdinPayload: "",
        },
        { signal: controller.signal, onStarted: assignStarted },
      )
      .then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
    let keepJob = false;
    try {
      const outcome = await Promise.race([launchPromise, timeoutResult]);
      if (outcome === "timeout") {
        await this.jobManager.terminateJob(job, "timeout");
        this.noteLatency(spec.attemptId, this.clock() - started);
        throw new MxcCommandTimeoutError(timeout);
      }
      if (outcome === "cancel") {
        throw new MxcCommandTimeoutError(timeout);
      }
      if (!outcome.ok) throw outcome.error;
      await assignStarted(outcome.value.pid);
      await this.jobManager.queryJobAccounting(job);
      const denied = outcome.value.denied.map((entry) => this.osDenial(spec.attemptId, entry));
      for (const event of denied) emitDenial(this.logger, this.governor, event);
      const latencyMs = this.noteLatency(spec.attemptId, this.clock() - started);
      if (sealed.mode === "wrapped") keepJob = true;
      return {
        exitCode: outcome.value.exitCode,
        stdout: outcome.value.stdout,
        stderr: outcome.value.stderr,
        pid: outcome.value.pid,
        denied,
        latencyMs,
        enforcement: this.kernel.kind === "test_double" ? "test_double" : "os_mxc",
        frozenAt: sealed.frozenAt,
      };
    } finally {
      clearTimeout(timer);
      settleTimer("cancel");
      if (!keepJob && instance.job) {
        await instance.job.close();
        instance.job = null;
      }
    }
  }

  private osDenial(
    attemptId: string,
    entry: MxcKernelLaunchResult["denied"][number],
  ): DenialAuditEvent {
    return {
      type: "sandbox_denial",
      tier: "A",
      attemptId,
      target: entry.target,
      access: entry.access,
      errno: entry.errno,
      ruleId: entry.ruleId,
      source: "os",
    };
  }

  private noteLatency(attemptId: string, latencyMs: number): number {
    const stats = this.latencies.record(latencyMs);
    emitLatency(this.logger, this.governor, {
      tier: "A",
      attemptId,
      latencyMs,
      p50Ms: stats.p50Ms,
      p95Ms: stats.p95Ms,
    });
    return latencyMs;
  }

  private rejectBackground(cmd: CommandSpec): void {
    if (cmd.background === true || cmd.detach === true) throw new MxcForegroundExitError();
  }

  private requireWarm(instance: SandboxInstance): WarmMxcInstance {
    if (!(instance instanceof WarmMxcInstance)) {
      throw new MxcModeError("foreign_instance", "Instance was not created by TierAMxcProvider");
    }
    return instance;
  }
}

export function createTierAMxcProvider(options: TierAMxcProviderOptions): TierAMxcProvider {
  return new TierAMxcProvider(options);
}

const BASELINE_NAMES = [
  "ALLUSERSPROFILE",
  "CommonProgramFiles",
  "CommonProgramFiles(x86)",
  "CommonProgramW6432",
  "COMPUTERNAME",
  "ComSpec",
  "HOMEDRIVE",
  "NUMBER_OF_PROCESSORS",
  "OS",
  "PATHEXT",
  "PROCESSOR_ARCHITECTURE",
  "PROCESSOR_IDENTIFIER",
  "PROCESSOR_LEVEL",
  "PROCESSOR_REVISION",
  "ProgramData",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "ProgramW6432",
  "PUBLIC",
  "SystemDrive",
  "SystemRoot",
  "USERDOMAIN",
  "USERNAME",
  "windir",
  "PATH",
] as const;

function readNamedBaseline(): Record<string, string | undefined> {
  const source: Record<string, string | undefined> = {};
  for (const key of BASELINE_NAMES) {
    const value = process.env[key];
    if (typeof value === "string") source[key] = value;
  }
  return source;
}

async function wipeDirectory(target: string): Promise<void> {
  await fs.rm(target, { recursive: true, force: true });
  await fs.mkdir(target, { recursive: true });
}
