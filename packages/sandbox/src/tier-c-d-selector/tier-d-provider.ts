import { createProcessRunner } from "./command-runner.js";
import type { CommandOutput, CommandRunner } from "./command-runner.js";
import { assertLeastPrivilegeArgs, buildTierDContainerArgs } from "./tier-d-args.js";
import type { TierDRunSpec } from "./tier-d-args.js";
import type {
  CommandResult,
  CommandSpec,
  SandboxInstance,
  SandboxLaunchSpec,
  SandboxTierProvider,
  TierCapabilityFlags,
  TierProbeResult,
  WrappedProcessHandle,
} from "./types.js";

const DOCKER_PROBE_MS = 3_000;

export interface TierDProviderOptions {
  readonly runner?: CommandRunner;
  readonly dockerCommand?: string;
  readonly wslCommand?: string;
}

interface DockerProbe {
  readonly available: boolean;
  readonly installed: boolean;
  readonly reason?: "daemon_not_running" | "not_installed";
}

function tierDCapabilities(available: boolean): TierCapabilityFlags {
  return {
    fileWritesEnforced: available,
    secretReadsDenied: available,
    networkEnforced: available,
    requiresAdmin: false,
  };
}

export class TierDContainerProvider implements SandboxTierProvider {
  readonly tier = "D" as const;
  private readonly runner: CommandRunner;
  private readonly dockerCommand: string;
  private readonly wslCommand: string;
  private readonly runs = new Map<string, TierDRunSpec>();
  private lastCapabilities: TierCapabilityFlags = tierDCapabilities(false);

  constructor(options: TierDProviderOptions = {}) {
    this.runner = options.runner ?? createProcessRunner();
    this.dockerCommand = options.dockerCommand ?? "docker";
    this.wslCommand = options.wslCommand ?? "wsl.exe";
  }

  get capabilities(): TierCapabilityFlags {
    return this.lastCapabilities;
  }

  async probe(): Promise<TierProbeResult> {
    const [docker, wslAvailable] = await Promise.all([this.probeDocker(), this.probeWsl()]);
    this.lastCapabilities = tierDCapabilities(docker.available);
    const result: TierProbeResult = {
      tier: "D",
      available: docker.available,
      installed: docker.installed,
      wsl2Available: wslAvailable,
      backend: docker.available ? "docker" : "none",
      requiresAdmin: false,
      capabilities: this.lastCapabilities,
    };
    if (!docker.available && docker.reason) return { ...result, reason: docker.reason };
    return result;
  }

  async acquireWarmInstance(spec: SandboxLaunchSpec): Promise<SandboxInstance> {
    this.runs.set(spec.attemptId, runSpecFromLaunch(spec));
    return { id: spec.attemptId, tier: "D", worktreePath: spec.worktreePath, tempPath: spec.tempPath };
  }

  async executeCommand(instance: SandboxInstance, command: CommandSpec): Promise<CommandResult> {
    const saved = this.runs.get(instance.id);
    if (!saved) throw new Error("Tier D instance was not acquired.");
    const args = buildTierDContainerArgs({
      ...saved,
      commandId: command.commandId,
      command: [command.executable, ...command.args],
    });
    assertLeastPrivilegeArgs(args);
    const result = await this.runner.run(this.dockerCommand, args, { timeoutMs: command.timeoutMs ?? 60_000 });
    return {
      exitCode: result.code ?? 1,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: result.timedOut,
    };
  }

  async spawnWrappedProcess(spec: SandboxLaunchSpec): Promise<WrappedProcessHandle> {
    const args = buildTierDContainerArgs({
      ...runSpecFromLaunch(spec),
      commandId: "wrapped",
      command: ["sleep", "infinity"],
    });
    assertLeastPrivilegeArgs(args);
    await this.runner.run(this.dockerCommand, args, { timeoutMs: 60_000 });
    return { pid: 0, tier: "D" };
  }

  async disposeInstance(instance: SandboxInstance): Promise<void> {
    this.runs.delete(instance.id);
  }

  async reconcileManagedContainers(filter?: {
    readonly projectId?: string;
    readonly attemptId?: string;
  }): Promise<{ readonly removed: readonly string[] }> {
    const args = ["ps", "-aq", "--filter", "label=ef-harness.managed=true"];
    if (filter?.projectId) args.push("--filter", `label=ef-harness.project=${filter.projectId}`);
    if (filter?.attemptId) args.push("--filter", `label=ef-harness.attempt=${filter.attemptId}`);
    const listed = await this.runner.run(this.dockerCommand, args, { timeoutMs: 10_000 });
    const ids = listed.stdout.split(/\s+/).map((item) => item.trim()).filter((item) => item.length > 0);
    if (ids.length === 0 || listed.notFound) return { removed: [] };
    await this.runner.run(this.dockerCommand, ["rm", "-f", ...ids], { timeoutMs: 20_000 });
    return { removed: ids };
  }

  private async probeDocker(): Promise<DockerProbe> {
    const result = await this.runBounded(this.dockerCommand, ["info"], DOCKER_PROBE_MS);
    if (result.notFound) return { available: false, installed: false, reason: "not_installed" };
    if (result.timedOut || result.code !== 0) return { available: false, installed: true, reason: "daemon_not_running" };
    return { available: true, installed: true };
  }

  private async probeWsl(): Promise<boolean> {
    const result = await this.runBounded(this.wslCommand, ["--status"], DOCKER_PROBE_MS);
    return !result.notFound && !result.timedOut && result.code === 0;
  }

  private runBounded(command: string, args: readonly string[], timeoutMs: number): Promise<CommandOutput> {
    return new Promise((resolve) => {
      const controller = new AbortController();
      let settled = false;
      const finish = (value: CommandOutput): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => {
        controller.abort();
        finish({ code: null, stdout: "", stderr: "", timedOut: true, notFound: false });
      }, timeoutMs);
      this.runner.run(command, args, { timeoutMs, signal: controller.signal }).then(
        (value) => finish(value),
        () => finish({ code: 1, stdout: "", stderr: "", timedOut: false, notFound: false }),
      );
    });
  }
}

function runSpecFromLaunch(spec: SandboxLaunchSpec): TierDRunSpec {
  const run: TierDRunSpec = {
    projectId: spec.projectId,
    attemptId: spec.attemptId,
    commandId: "acquired",
    worktreePath: spec.worktreePath,
    tempPath: spec.tempPath,
    packageStorePath: spec.packageStorePath ?? spec.worktreePath,
    image: "node:22-bookworm",
    command: [],
  };
  if (!spec.limits) return run;
  return {
    ...run,
    ...(spec.limits.memoryBytes ? { memoryBytes: spec.limits.memoryBytes } : {}),
    ...(spec.limits.pidsLimit ? { pidsLimit: spec.limits.pidsLimit } : {}),
    ...(spec.limits.cpus ? { cpus: spec.limits.cpus } : {}),
  };
}

export { buildTierDContainerArgs, assertLeastPrivilegeArgs } from "./tier-d-args.js";
export type { TierDRunSpec } from "./tier-d-args.js";
