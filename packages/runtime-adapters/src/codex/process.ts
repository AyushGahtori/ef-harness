import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { CodexRuntimeError } from "./errors.js";
import type { CodexConnection } from "./types.js";

const FORBIDDEN_ARG = /danger-full-access|(?:^|\s)--yolo(?:\s|$)|(?:^|\s)-yolo(?:\s|$)|approval-policy(?:=|\s+)never/i;

const HOST_ENV_KEEP = [
  "PATH",
  "Path",
  "PATHEXT",
  "SystemRoot",
  "SYSTEMROOT",
  "ComSpec",
  "COMSPEC",
  "WINDIR",
  "TEMP",
  "TMP",
  "PROCESSOR_ARCHITECTURE",
  "NUMBER_OF_PROCESSORS",
  "OS",
] as const;

export interface SpawnRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}

export interface SpawnedProcess {
  readonly pid: number;
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  kill(): void;
  onExit(listener: (code: number | null) => void): void;
  readonly exited: Promise<number | null>;
}

export type ProcessSpawner = (input: SpawnRequest) => SpawnedProcess;

export function assertSafeCodexArgs(args: readonly string[]): void {
  const joined = args.join(" ");
  if (FORBIDDEN_ARG.test(joined) || args.some((arg) => FORBIDDEN_ARG.test(arg))) {
    throw new CodexRuntimeError(
      "unrestricted_sandbox",
      "refusing danger-full-access, --yolo, or approval-policy never",
    );
  }
}

export function assertSafeCodexConfig(toml: string): void {
  if (FORBIDDEN_ARG.test(toml) || /sandbox_mode\s*=\s*"danger-full-access"/i.test(toml)) {
    throw new CodexRuntimeError(
      "unrestricted_sandbox",
      "Codex config refuses danger-full-access, --yolo, and approval-policy never",
    );
  }
  if (!/sandbox_mode\s*=\s*"workspace-write"/.test(toml)) {
    throw new CodexRuntimeError("unrestricted_sandbox", "Codex sandbox_mode must be workspace-write");
  }
  if (!/approval_policy\s*=\s*"on-request"/.test(toml)) {
    throw new CodexRuntimeError("unrestricted_sandbox", "Codex approval_policy must be on-request");
  }
}

export function buildCodexEnv(input: {
  readonly hostEnv: NodeJS.ProcessEnv;
  readonly codexHome: string;
  readonly connection: CodexConnection;
  readonly proxy: string;
  readonly mcpBearer: string;
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of HOST_ENV_KEEP) {
    const value = input.hostEnv[key];
    if (typeof value === "string") env[key] = value;
  }
  env.CODEX_HOME = input.codexHome;
  env.HOME = input.codexHome;
  env.USERPROFILE = input.codexHome;
  env.HTTP_PROXY = input.proxy;
  env.HTTPS_PROXY = input.proxy;
  env.NO_PROXY = "127.0.0.1,localhost";
  env.EF_HARNESS_MCP_BEARER = input.mcpBearer;
  if (input.connection.kind === "sign_in_with_chatgpt") {
    env.ACCESS_TOKEN = input.connection.accessToken;
  } else {
    env.OPENAI_API_KEY = input.connection.apiKey;
  }
  return env;
}

export function nodeSpawn(input: SpawnRequest): SpawnedProcess {
  assertSafeCodexArgs(input.args);
  const child = spawn(input.command, [...input.args], {
    cwd: input.cwd,
    env: input.env,
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  return wrapChild(child);
}

export function wrapChild(child: ChildProcess): SpawnedProcess {
  if (!child.pid || !child.stdin || !child.stdout || !child.stderr) {
    child.kill();
    throw new CodexRuntimeError("spawn_failed", "failed to spawn the codex process");
  }
  const pid = child.pid;
  let exitCode: number | null = null;
  let settled = false;
  const listeners = new Set<(code: number | null) => void>();
  let resolveExit: (code: number | null) => void = () => undefined;
  const exited = new Promise<number | null>((resolve) => {
    resolveExit = resolve;
  });
  const finish = (code: number | null) => {
    if (settled) return;
    settled = true;
    exitCode = code;
    resolveExit(code);
    for (const listener of listeners) listener(code);
  };
  child.on("exit", (code) => finish(code));
  child.on("error", () => finish(1));
  return {
    pid,
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    kill() {
      killPid(pid);
    },
    onExit(listener) {
      if (settled) listener(exitCode);
      else listeners.add(listener);
    },
    exited,
  };
}

export function killPid(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    process.kill(pid);
  } catch (error) {
    if (isMissingProcess(error)) return;
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      return;
    }
    throw error;
  }
}

export function readCommandVersion(command: string, args: readonly string[]): string | null {
  assertSafeCodexArgs(args);
  const result = spawnSync(command, [...args], {
    encoding: "utf8",
    windowsHide: true,
    shell: false,
  });
  if (result.status !== 0) return null;
  const match = /(\d+\.\d+\.\d+)/.exec(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  return match?.[1] ?? null;
}

function isMissingProcess(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH";
}

/** Local stand-in for Task 041 `WindowsJobSupervisor`. `taskkill /T /F` reaps the recorded tree. */
export class LocalWindowsJob {
  private readonly jobs = new Map<string, Set<number>>();

  create(sessionId: string): { readonly jobId: string } {
    const jobId = `job-${sessionId}`;
    if (this.jobs.has(jobId)) {
      throw new CodexRuntimeError("job_exists", `job ${jobId} already exists`);
    }
    this.jobs.set(jobId, new Set());
    return { jobId };
  }

  attach(jobId: string, pid: number): void {
    const pids = this.jobs.get(jobId);
    if (!pids) throw new CodexRuntimeError("unknown_job", `unknown job ${jobId}`);
    if (!Number.isInteger(pid) || pid <= 0) {
      throw new CodexRuntimeError("invalid_pid", "job attach requires a positive pid");
    }
    pids.add(pid);
  }

  list(jobId: string): readonly number[] {
    return [...(this.jobs.get(jobId) ?? [])];
  }

  kill(jobId: string, reason: string): readonly number[] {
    const pids = [...(this.jobs.get(jobId) ?? [])];
    for (const pid of pids) killPid(pid);
    this.jobs.set(jobId, new Set());
    if (reason.length === 0) return pids;
    return pids;
  }
}
