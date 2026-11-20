import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NetworkPathRejectedError, TierCLaunchError, WorktreeNotEmptyError, WrappedModeForbiddenOnTierCError } from "./errors.js";
import { buildTierCEnvironment, buildWindowsCommandLine, environmentBlockText } from "./environment.js";
import { assertSafeAbsolutePath, pathClassFromDrive } from "./paths.js";
import { TierCBroker } from "./tier-c-broker.js";
import type { TierCBrokerApi } from "./tier-c-broker.js";
import type {
  CommandResult,
  CommandSpec,
  SandboxInstance,
  SandboxLaunchSpec,
  SandboxTierProvider,
  TierCapabilityFlags,
  TierProbeResult,
  WindowsJobManager,
  WrappedProcessHandle,
} from "./types.js";

export const TIER_C_MARKER = ".ef-harness-tierc.json";

export const TIER_C_CAPABILITIES: TierCapabilityFlags = Object.freeze({
  fileWritesEnforced: true,
  secretReadsDenied: false,
  networkEnforced: false,
  requiresAdmin: false,
  badge: "weaker_sandbox_yellow",
});

export function createSyntheticCapabilitySid(): string {
  const authorities = [crypto.randomInt(1, 0xffff_fffe), crypto.randomInt(1, 0xffff_fffe), crypto.randomInt(1, 0xffff_fffe)];
  const rid = crypto.randomInt(1000, 100_000);
  return `S-1-5-21-${authorities[0]}-${authorities[1]}-${authorities[2]}-${rid}`;
}

interface MarkerFile {
  readonly sid: string;
  readonly version: 1;
}

export interface TierCProviderOptions {
  readonly broker?: TierCBrokerApi;
  readonly jobManager?: WindowsJobManager;
  readonly driveType?: (target: string) => Promise<string>;
  readonly systemRoot?: string;
  readonly pathEntries?: readonly string[];
}

function readMarker(markerPath: string): MarkerFile | undefined {
  if (!fs.existsSync(markerPath)) return undefined;
  const parsed = JSON.parse(fs.readFileSync(markerPath, "utf8")) as Partial<MarkerFile>;
  if (!parsed.sid || parsed.version !== 1) {
    throw new TierCLaunchError(`Tier C marker at ${markerPath} is unreadable.`);
  }
  return { sid: parsed.sid, version: 1 };
}

function executableDirectory(executable: string): string {
  return path.dirname(executable);
}

export class TierCRestrictedTokenProvider implements SandboxTierProvider {
  readonly tier = "C" as const;
  readonly capabilities = TIER_C_CAPABILITIES;
  private readonly broker: TierCBrokerApi;
  private readonly jobManager: WindowsJobManager | undefined;
  private readonly driveType: ((target: string) => Promise<string>) | undefined;
  private readonly systemRoot: string;

  constructor(options: TierCProviderOptions = {}) {
    this.broker = options.broker ?? new TierCBroker();
    this.jobManager = options.jobManager;
    this.driveType = options.driveType;
    this.systemRoot = options.systemRoot ?? process.env.SystemRoot ?? "C:\\Windows";
    this.pathEntries = options.pathEntries;
  }

  private readonly pathEntries: readonly string[] | undefined;

  async probe(): Promise<TierProbeResult> {
    const available = process.platform === "win32";
    const result: TierProbeResult = {
      tier: "C",
      available,
      requiresAdmin: false,
      capabilities: this.capabilities,
    };
    if (available) return result;
    return { ...result, reason: "unsupported_platform" };
  }

  async classifyPath(target: string): Promise<"local" | "unc" | "network"> {
    const resolved = assertSafeAbsolutePath(target);
    if (!this.driveType && process.platform !== "win32") return "local";
    const drive = this.driveType ? await this.driveType(resolved) : (await this.broker.classify(resolved)).drive ?? "unknown";
    return pathClassFromDrive(drive);
  }

  async acquireWarmInstance(spec: SandboxLaunchSpec): Promise<SandboxInstance> {
    const worktree = assertSafeAbsolutePath(spec.worktreePath);
    const temp = assertSafeAbsolutePath(spec.tempPath);
    await this.assertLocalDisk(worktree);
    await this.assertLocalDisk(temp);
    fs.mkdirSync(worktree, { recursive: true });
    fs.mkdirSync(temp, { recursive: true });
    const markerPath = path.join(worktree, TIER_C_MARKER);
    const existing = readMarker(markerPath);
    const sid = existing?.sid ?? createSyntheticCapabilitySid();
    if (!existing) {
      this.assertEmpty(worktree);
      this.assertEmpty(temp);
      const prepared = await this.broker.prepare({ worktree, temp, capabilitySid: sid });
      if (!prepared.ok) {
        throw new TierCLaunchError(prepared.error ?? "Tier C ACL prepare failed.");
      }
      const marker: MarkerFile = { sid, version: 1 };
      fs.writeFileSync(markerPath, JSON.stringify(marker));
    }
    return { id: spec.attemptId, tier: "C", worktreePath: worktree, tempPath: temp, capabilitySid: sid };
  }

  async executeCommand(instance: SandboxInstance, command: CommandSpec): Promise<CommandResult> {
    if (!instance.worktreePath || !instance.tempPath || !instance.capabilitySid) {
      throw new TierCLaunchError("Tier C execution requires a prepared warm instance.");
    }
    const env = buildTierCEnvironment({
      tempPath: instance.tempPath,
      systemRoot: this.systemRoot,
      pathEntries: this.pathEntries ?? [path.join(this.systemRoot, "System32"), executableDirectory(command.executable)],
      extra: { EF_HARNESS_ATTEMPT_ID: instance.id },
    });
    const pidFile = path.join(instance.tempPath, `${command.commandId}.pid`);
    const controlFile = path.join(instance.tempPath, `${command.commandId}.control`);
    const suspend = this.jobManager !== undefined;
    const job = suspend
      ? this.jobManager?.createJob({
          name: `ef-tierc-${instance.id}-${command.commandId}`,
          activeProcessLimit: 64,
        })
      : undefined;
    const launchPromise = this.broker.launch({
      capabilitySid: instance.capabilitySid,
      suspend,
      pidFile,
      controlFile,
      executable: command.executable,
      commandLine: buildWindowsCommandLine(command.executable, command.args),
      cwd: instance.worktreePath,
      envText: environmentBlockText(env),
      timeoutMs: command.timeoutMs ?? 60_000,
    });
    if (suspend && job && this.jobManager) {
      try {
        const pidText = await waitForText(pidFile, 15_000);
        const pid = Number(pidText);
        if (!Number.isInteger(pid) || pid <= 0) {
          fs.writeFileSync(controlFile, "terminate");
          throw new TierCLaunchError(`Tier C broker returned an invalid pid: ${pidText}`);
        }
        this.jobManager.assignProcess(job, pid);
        fs.writeFileSync(controlFile, "resume");
      } catch (error) {
        if (!fs.existsSync(controlFile)) fs.writeFileSync(controlFile, "terminate");
        await launchPromise.catch(() => undefined);
        throw error;
      }
    }
    const result = await launchPromise;
    if (job && this.jobManager?.closeJob) this.jobManager.closeJob(job);
    if (!result.ok) throw new TierCLaunchError(result.error ?? "Tier C launch failed. The command was not run unsandboxed.");
    return {
      exitCode: result.exitCode ?? 1,
      stdout: "",
      stderr: "",
      timedOut: result.timedOut === true,
    };
  }

  spawnWrappedProcess(spec: SandboxLaunchSpec): Promise<WrappedProcessHandle> {
    return Promise.reject(new WrappedModeForbiddenOnTierCError(spec.projectId));
  }

  async disposeInstance(instance: SandboxInstance): Promise<void> {
    if (!instance.tempPath || !fs.existsSync(instance.tempPath)) return;
    for (const entry of fs.readdirSync(instance.tempPath)) {
      fs.rmSync(path.join(instance.tempPath, entry), { recursive: true, force: true });
    }
  }

  private async assertLocalDisk(target: string): Promise<void> {
    const kind = await this.classifyPath(target);
    if (kind !== "local") throw new NetworkPathRejectedError(target);
  }

  private assertEmpty(target: string): void {
    const entries = fs.readdirSync(target).filter((entry) => entry !== TIER_C_MARKER);
    if (entries.length > 0) throw new WorktreeNotEmptyError(target);
  }
}

async function waitForText(file: string, timeoutMs: number): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (fs.existsSync(file)) {
      const text = fs.readFileSync(file, "utf8").trim();
      if (text) return text;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new TierCLaunchError("Timed out waiting for the suspended Tier C process.");
}
