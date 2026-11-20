import { spawn } from "node:child_process";
import fs from "node:fs";
import { freezeDenyReadAtStart } from "./deny-read.js";
import { SandboxUnavailableError } from "./errors.js";
import { environmentPairs } from "./env.js";
import { MXC_HELPER_PIN } from "./constants.js";
import type {
  CompiledMxcPolicy,
  MxcKernelBackend,
  MxcKernelLaunchRequest,
  MxcKernelLaunchResult,
  OsDenial,
  ProcessSpawner,
  SpawnRequest,
  SpawnResult,
} from "./types.js";

export interface HelperPayload {
  readonly protocol: "ef-mxc-launch/1";
  readonly pin: string;
  readonly identity: "ef-harness-tier-a";
  readonly failOpen: false;
  readonly specIdentifier: "SBOX";
  readonly callsExportDirectly: false;
  readonly grantModel: "policy";
  readonly requireNativeDenyPaths: true;
  readonly allowLocalBinding: true;
  readonly denyReadEvaluatedAt: "process_start";
  readonly denyReadFiles: readonly string[];
  readonly denyReadPrefixes: readonly string[];
  readonly policy: CompiledMxcPolicy;
  readonly command: { readonly file: string; readonly args: readonly string[] };
  readonly cwd: string;
  readonly env: readonly string[];
  readonly job: { readonly killOnJobClose: true; readonly uiRestrictions: true };
  readonly foregroundExitStopsChildren: true;
  readonly detachedServersOwner: "task_049_environment_orchestrator";
}

export function buildHelperPayload(request: MxcKernelLaunchRequest): HelperPayload {
  if (request.policy.writable.length === 0) {
    throw new SandboxUnavailableError("empty_mxc_spec");
  }
  if (request.policy.launch.failOpen !== false || request.policy.launch.specIdentifier !== "SBOX") {
    throw new SandboxUnavailableError("fail_open_spec");
  }
  if (request.policy.nuances.allowLocalBinding !== true) {
    throw new SandboxUnavailableError("allow_local_binding_required");
  }
  const frozen = freezeDenyReadAtStart(request.policy.rules);
  return {
    protocol: "ef-mxc-launch/1",
    pin: `${MXC_HELPER_PIN.source}@${MXC_HELPER_PIN.tag}#${MXC_HELPER_PIN.crate}`,
    identity: "ef-harness-tier-a",
    failOpen: false,
    specIdentifier: "SBOX",
    callsExportDirectly: false,
    grantModel: "policy",
    requireNativeDenyPaths: true,
    allowLocalBinding: true,
    denyReadEvaluatedAt: frozen.evaluatedAt,
    denyReadFiles: frozen.files,
    denyReadPrefixes: frozen.prefixes,
    policy: request.policy,
    command: { file: request.command, args: request.args },
    cwd: request.cwd,
    env: environmentPairs(request.env),
    job: { killOnJobClose: true, uiRestrictions: true },
    foregroundExitStopsChildren: true,
    detachedServersOwner: "task_049_environment_orchestrator",
  };
}

export function createPinnedHelperBackend(options: {
  readonly helperPath: string | null;
  readonly spawner: ProcessSpawner;
}): MxcKernelBackend {
  return {
    kind: "pinned_helper",
    async launch(request, context) {
      const helperPath = options.helperPath;
      if (!helperPath || !fs.existsSync(helperPath)) {
        throw new SandboxUnavailableError("mxc_requires_pinned_helper");
      }
      const payload = buildHelperPayload(request);
      const spawnRequest: SpawnRequest = {
        file: helperPath,
        args: ["--protocol", "ef-mxc-launch/1"],
        cwd: request.cwd,
        env: request.env,
        stdin: JSON.stringify(payload),
        signal: context.signal,
      };
      const started = context.onStarted;
      const spawned = await options.spawner.spawn(
        started ? { ...spawnRequest, onPid: (pid) => started(pid) } : spawnRequest,
      );
      return parseHelperStdout(spawned);
    },
  };
}

export function createNodeSpawner(): ProcessSpawner {
  return {
    async spawn(request: SpawnRequest): Promise<SpawnResult> {
      const env: NodeJS.ProcessEnv = {};
      for (const key of Object.keys(request.env)) {
        const value = request.env[key];
        if (typeof value === "string") env[key] = value;
      }
      const child = spawn(request.file, [...request.args], {
        shell: false,
        windowsHide: true,
        cwd: request.cwd,
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      if (!child.stdout || !child.stderr || !child.stdin) {
        child.kill();
        throw new SandboxUnavailableError("mxc_helper_stdio");
      }
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        if (stdout.length < 1_000_000) stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        if (stderr.length < 1_000_000) stderr += chunk;
      });
      const onAbort = (): void => {
        child.kill();
      };
      if (request.signal.aborted) onAbort();
      else request.signal.addEventListener("abort", onAbort, { once: true });
      const closed = new Promise<SpawnResult>((resolve, reject) => {
        child.on("error", (error) => {
          request.signal.removeEventListener("abort", onAbort);
          reject(error);
        });
        child.on("close", (exitCode) => {
          request.signal.removeEventListener("abort", onAbort);
          resolve({
            exitCode,
            stdout,
            stderr,
            pid: child.pid ?? 0,
          });
        });
      });
      const pid = child.pid;
      if (typeof pid === "number" && pid > 0 && request.onPid) {
        try {
          await request.onPid(pid);
        } catch (error) {
          child.kill();
          closed.catch(() => undefined);
          throw error;
        }
      }
      child.stdin.end(request.stdin);
      return await closed;
    },
  };
}

function parseHelperStdout(spawned: SpawnResult): MxcKernelLaunchResult {
  const line = spawned.stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .pop();
  if (!line) throw new SandboxUnavailableError("mxc_helper_protocol");
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new SandboxUnavailableError("mxc_helper_protocol");
  }
  if (!parsed || typeof parsed !== "object") throw new SandboxUnavailableError("mxc_helper_protocol");
  const record = parsed as Record<string, unknown>;
  if (typeof record.error === "string" && record.error.length > 0) {
    throw new SandboxUnavailableError(record.error.slice(0, 200));
  }
  if (record.failOpen === true || record.launched === false) {
    const reason = typeof record.reason === "string" && record.reason.length > 0 ? record.reason : "mxc_launch_failed";
    throw new SandboxUnavailableError(reason.slice(0, 200));
  }
  const exitCode = typeof record.exitCode === "number" ? record.exitCode : spawned.exitCode;
  const pid = typeof record.pid === "number" ? record.pid : spawned.pid;
  const denied = parseDenials(record.denied);
  return {
    launched: true,
    pid,
    exitCode,
    stdout: typeof record.stdout === "string" ? record.stdout : "",
    stderr: typeof record.stderr === "string" ? record.stderr : spawned.stderr,
    denied,
  };
}

function parseDenials(value: unknown): OsDenial[] {
  if (!Array.isArray(value)) return [];
  const denied: OsDenial[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const access = record.access;
    const errno = record.errno;
    const target = record.target;
    const ruleId = record.ruleId;
    if (
      (access === "read" || access === "write" || access === "network") &&
      (errno === "EACCES" || errno === "EPERM") &&
      typeof target === "string" &&
      typeof ruleId === "string"
    ) {
      denied.push({ access, errno, target, ruleId });
    }
  }
  return denied;
}
