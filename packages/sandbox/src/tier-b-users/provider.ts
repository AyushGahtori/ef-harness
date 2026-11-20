import fs from "node:fs/promises";
import path from "node:path";
import { EmptySlotAclManager } from "./acl.js";
import { compileTierBPolicy } from "./access.js";
import {
  DEFAULT_ACTIVE_PROCESS_LIMIT,
  DEFAULT_JOB_MEMORY_BYTES,
  DEFAULT_POOL_SIZE,
  TIER_B_CAPABILITIES,
  VENDOR_PROVIDER_HOSTS,
} from "./constants.js";
import {
  buildScrubbedEnvironment,
  cacheLayout,
  type EnvSource,
  injectSingleVendorToken,
  resolveTierBExecutionMode,
} from "./env.js";
import {
  CreateProcessAsUserError,
  TierBCommandTimeoutError,
  TierBError,
  TierBModeSRequiredError,
  TierBPoolError,
  TierBUnavailableError,
} from "./errors.js";
import { nearestRankPercentile } from "./memory.js";
import { probeTierB } from "./probe.js";
import { TierBAdminProvisioner } from "./provisioner.js";
import { buildRestrictedLogonPlan, selectSandboxAccount } from "./spawn.js";
import { assertTierBVolume } from "./volume.js";
import type {
  CommandResult,
  CommandSpec,
  JobHandle,
  JobLimits,
  LogonExecutor,
  SandboxAuditLogger,
  SandboxGovernorSink,
  SandboxInstance,
  SandboxLaunchSpec,
  SandboxTierProvider,
  TierBHostInspector,
  TierBProbe,
  TierCapabilityFlags,
  VolumeInfo,
  WindowsJobManagerPort,
  WrappedProcessHandle,
  WrappedProcessSpec,
} from "./types.js";

export interface TierBSandboxUsersProviderOptions {
  readonly provisioner: TierBAdminProvisioner;
  readonly inspector: TierBHostInspector;
  readonly volumeOf: (target: string) => VolumeInfo;
  readonly acl: EmptySlotAclManager;
  readonly jobManager: WindowsJobManagerPort;
  readonly logger: SandboxAuditLogger;
  readonly governor: SandboxGovernorSink;
  readonly logon: LogonExecutor;
  readonly poolSize?: number;
  readonly clock?: () => number;
  readonly envSource?: EnvSource;
  readonly platform?: NodeJS.Platform;
}

class WarmTierBInstance implements SandboxInstance {
  readonly tier = "B" as const;
  generation = 0;
  attemptId: string | null = null;
  tempDir: string | null = null;
  spec: SandboxLaunchSpec | null = null;
  capabilitySid: string | null = null;
  attemptJob: JobHandle | null = null;

  constructor(readonly id: string) {}
}

async function wipeDirectoryContents(dir: string): Promise<void> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "ENOENT") return;
    throw error;
  }
  await Promise.all(
    names.map(async (name) => {
      const full = path.join(dir, name);
      const stat = await fs.lstat(full);
      if (stat.isSymbolicLink()) {
        await fs.unlink(full);
        return;
      }
      await fs.rm(full, { recursive: true, force: true });
    }),
  );
}

async function withTimeout<T>(work: Promise<T>, timeoutMs: number | undefined): Promise<T> {
  if (timeoutMs === undefined) return work;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    void _resolve;
    timer = setTimeout(() => {
      reject(new TierBCommandTimeoutError(timeoutMs));
    }, timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class TierBSandboxUsersProvider implements SandboxTierProvider {
  readonly tier = "B" as const;
  readonly capabilities: TierCapabilityFlags = TIER_B_CAPABILITIES;
  private readonly instances: WarmTierBInstance[] = [];
  private readonly busy = new Set<string>();
  private readonly latencies: number[] = [];
  private readonly poolSize: number;
  private readonly clock: () => number;
  private jobSequence = 0;

  constructor(private readonly options: TierBSandboxUsersProviderOptions) {
    this.poolSize = options.poolSize ?? DEFAULT_POOL_SIZE;
    if (!Number.isInteger(this.poolSize) || this.poolSize < 1) {
      throw new TierBError("invalid_pool_size", "Warm pool size must be a positive integer");
    }
    this.clock = options.clock ?? (() => performance.now());
  }

  probe(): Promise<TierBProbe> {
    return Promise.resolve(probeTierB(this.options.inspector, this.options.provisioner.firewallRules()));
  }

  async acquireWarmInstance(spec: SandboxLaunchSpec): Promise<SandboxInstance> {
    this.assertVolume(spec.worktree);
    this.assertVolume(spec.tempDir);
    this.assertVolume(spec.buildOutputDir);
    const health = probeTierB(this.options.inspector, this.options.provisioner.firewallRules());
    if (!health.available) throw new TierBUnavailableError(health.missingComponents);
    this.assertPorts(spec.proxyPort, spec.mcpPort);
    const slot = this.options.acl.requireSlotGrant(spec.worktree);
    this.options.acl.ensureEmptyGrant(spec.tempDir, "temp");
    let instance = this.instances.find((item) => !this.busy.has(item.id));
    if (!instance) {
      if (this.instances.length >= this.poolSize) throw new TierBPoolError(this.poolSize);
      instance = new WarmTierBInstance(`tier-b-${this.instances.length + 1}`);
      this.instances.push(instance);
    }
    await wipeDirectoryContents(spec.tempDir);
    const limits = this.limitsFor(spec);
    if (!instance.attemptJob) {
      this.jobSequence += 1;
      instance.attemptJob = await this.options.jobManager.createJob(`tier-b-attempt-${this.jobSequence}`, limits);
    }
    instance.generation += 1;
    instance.attemptId = spec.attemptId;
    instance.tempDir = spec.tempDir;
    instance.spec = spec;
    instance.capabilitySid = slot.capabilitySid;
    compileTierBPolicy(spec, slot.capabilitySid);
    this.busy.add(instance.id);
    return instance;
  }

  executeCommand(instance: SandboxInstance, cmdSpec: CommandSpec): Promise<CommandResult> {
    return this.run(instance, cmdSpec, null);
  }

  async spawnWrappedProcess(spec: WrappedProcessSpec): Promise<WrappedProcessHandle> {
    const decision = resolveTierBExecutionMode(spec.vendor, "wrapped");
    if (decision.mode !== "wrapped" || decision.homeAclMutations.length !== 0) {
      throw new TierBModeSRequiredError(spec.vendor);
    }
    if (spec.tokenKind === "subscription") {
      throw new TierBError("subscription_token_rejected", "Subscription tokens are never stored or injected");
    }
    if (decision.tokenEnv && (spec.token === undefined || spec.token.length === 0)) {
      throw new TierBError("wrapped_vendor_token_required", `Wrapped ${spec.vendor} requires its single scoped token`);
    }
    const instance = await this.acquireWarmInstance({
      attemptId: spec.attemptId,
      worktree: spec.worktree,
      tempDir: spec.tempDir,
      buildOutputDir: spec.buildOutputDir,
      developerCheckout: spec.developerCheckout,
      harnessDataRoot: spec.harnessDataRoot,
      userProfile: spec.userProfile,
      localAppData: spec.localAppData,
      appData: spec.appData,
      toolchainRoots: spec.toolchainRoots,
      pnpmStore: spec.pnpmStore,
      otherWorktrees: spec.otherWorktrees,
      mcpPort: spec.mcpPort,
      proxyPort: spec.proxyPort,
      mode: "wrapped",
      vendor: spec.vendor,
    });
    try {
      const result = await this.run(
        instance,
        {
          command: spec.command,
          ...(spec.args ? { args: spec.args } : {}),
          ...(spec.timeoutMs === undefined ? {} : { timeoutMs: spec.timeoutMs }),
          purpose: "coding_worker",
        },
        spec.token ?? null,
      );
      return {
        instance,
        pid: result.pid,
        vendor: spec.vendor,
        providerHosts: VENDOR_PROVIDER_HOSTS[spec.vendor],
        enforcement: result.enforcement,
        mode: "wrapped",
      };
    } catch (error) {
      await this.disposeInstance(instance);
      throw error;
    }
  }

  async disposeInstance(instance: SandboxInstance): Promise<void> {
    const warm = this.requireWarm(instance);
    if (warm.attemptJob) {
      await this.options.jobManager.terminateJob(warm.attemptJob, "dispose");
      await warm.attemptJob.close();
      warm.attemptJob = null;
    }
    if (warm.tempDir) await wipeDirectoryContents(warm.tempDir);
    warm.attemptId = null;
    warm.tempDir = null;
    warm.spec = null;
    warm.capabilitySid = null;
    this.busy.delete(warm.id);
  }

  private async run(instance: SandboxInstance, cmdSpec: CommandSpec, token: string | null): Promise<CommandResult> {
    const warm = this.requireWarm(instance);
    if (!warm.spec || !warm.capabilitySid || !warm.attemptJob || !warm.tempDir || !warm.attemptId) {
      throw new TierBError("instance_unbound", "Warm Tier B instance is not bound to an attempt");
    }
    if (cmdSpec.detach === true) {
      throw new TierBError(
        "detached_command_rejected",
        "Detached processes stay on the environment job. Tier B commands close their nested job when the command returns.",
      );
    }
    const started = this.clock();
    const account = selectSandboxAccount(cmdSpec);
    const redirects = cacheLayout(warm.tempDir, warm.spec.proxyPort);
    let env = buildScrubbedEnvironment(this.options.envSource ?? process.env, redirects, account.name);
    if (token !== null) {
      const vendor = warm.spec.vendor;
      if (!vendor) throw new TierBError("wrapped_vendor_required", "A wrapped command needs a vendor");
      env = injectSingleVendorToken(env, vendor, token);
    }
    const plan = buildRestrictedLogonPlan({
      account: account.name,
      restrictingSids: [warm.capabilitySid],
      env,
      command: cmdSpec.command,
      args: cmdSpec.args ?? [],
      cwd: warm.spec.worktree,
      proxyDeclaredEndpoints: cmdSpec.declaredEndpoints ?? [],
      enforcement: this.options.logon.enforcement,
      ...(this.options.platform ? { platform: this.options.platform } : {}),
    });
    this.jobSequence += 1;
    const commandJob = await this.options.jobManager.createJob(
      `tier-b-command-${this.jobSequence}`,
      this.limitsFor(warm.spec),
      warm.attemptJob,
    );
    try {
      const launched = await withTimeout(this.options.logon.launch(plan), cmdSpec.timeoutMs);
      await this.options.jobManager.assignProcess(commandJob, launched.pid);
      const latencyMs = this.clock() - started;
      this.latencies.push(latencyMs);
      const sample = {
        tier: "B" as const,
        attemptId: warm.attemptId,
        latencyMs,
        p50Ms: nearestRankPercentile(this.latencies, 50),
        p95Ms: nearestRankPercentile(this.latencies, 95),
      };
      this.options.governor.reportLaunchLatency(sample);
      return {
        exitCode: launched.exitCode,
        stdout: launched.stdout,
        stderr: launched.stderr,
        pid: launched.pid,
        denied: [],
        latencyMs,
        enforcement: launched.enforcement,
        account: account.name,
        desktop: plan.desktop.lpDesktop,
      };
    } catch (error) {
      if (error instanceof CreateProcessAsUserError) {
        this.options.logger.write({
          ts: new Date().toISOString(),
          level: "error",
          component: "tier-b-users",
          msg: error.message,
          fields: {
            api: error.api,
            win32Error: error.win32Error,
            edrHint: error.edrHint,
            logEvent: "tier_b_create_process_as_user_failed",
            attemptId: warm.attemptId,
            account: account.name,
          },
        });
      }
      if (error instanceof TierBCommandTimeoutError) {
        await this.options.jobManager.terminateJob(commandJob, "timeout");
      }
      throw error;
    } finally {
      await commandJob.close();
      await wipeDirectoryContents(warm.tempDir);
    }
  }

  private assertVolume(target: string): void {
    assertTierBVolume(target, this.options.volumeOf(target));
  }

  private assertPorts(proxyPort: number, mcpPort: number): void {
    if (proxyPort !== this.options.provisioner.proxyPort || mcpPort !== this.options.provisioner.mcpPort) {
      throw new TierBError(
        "firewall_port_mismatch",
        "This attempt's loopback ports do not match the Tier B firewall rules",
      );
    }
  }

  private limitsFor(spec: SandboxLaunchSpec): JobLimits {
    return {
      killOnJobClose: true,
      jobMemoryBytes: spec.jobMemoryBytes ?? DEFAULT_JOB_MEMORY_BYTES,
      activeProcessLimit: spec.activeProcessLimit ?? DEFAULT_ACTIVE_PROCESS_LIMIT,
      uiRestrictions: true,
    };
  }

  private requireWarm(instance: SandboxInstance): WarmTierBInstance {
    const warm = this.instances.find((item) => item.id === instance.id);
    if (!warm || warm.tier !== "B") throw new TierBError("unknown_instance", "Tier B instance is not from this provider");
    return warm;
  }
}

export function createTierBSandboxUsersProvider(options: TierBSandboxUsersProviderOptions): TierBSandboxUsersProvider {
  return new TierBSandboxUsersProvider(options);
}
