import { spawnSync } from "node:child_process";

import { GitCommandError } from "./errors.js";

export interface GitExecResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}

export interface GitExecRequest {
  readonly cwd: string;
  readonly args: readonly string[];
  readonly stdin?: string;
  readonly env?: Readonly<NodeJS.ProcessEnv>;
  readonly timeoutMs?: number;
}

/**
 * Consumer port for Task 035 `GitRunner`.
 * `execGit` is synchronous here. A wiring adapter can await Task 035's promise
 * and return this same result shape.
 */
export interface GitRunner {
  resolveGitBinary(): string;
  execGit(request: GitExecRequest): GitExecResult;
}

export interface GitSpawnResult {
  readonly status: number | null;
  readonly stdout: string | null;
  readonly stderr: string | null;
  readonly error?: Error;
}

export interface GitSpawnOptions {
  readonly cwd: string;
  readonly input?: string;
  readonly env: NodeJS.ProcessEnv;
  readonly shell: false;
  readonly windowsHide: true;
  readonly timeout: number;
}

export type GitSpawn = (
  binary: string,
  args: readonly string[],
  options: GitSpawnOptions,
) => GitSpawnResult;

const DEFAULT_TIMEOUT_MS = 30_000;

export function createDirectGitRunner(options?: {
  readonly binary?: string;
  readonly spawn?: GitSpawn;
}): GitRunner {
  const binary = options?.binary ?? "git";
  const spawn = options?.spawn ?? defaultSpawn;
  return new DirectGitRunner(binary, spawn);
}

class DirectGitRunner implements GitRunner {
  constructor(
    private readonly binary: string,
    private readonly spawn: GitSpawn,
  ) {}

  resolveGitBinary(): string {
    const result = this.spawn(this.binary, ["--version"], {
      cwd: process.cwd(),
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      shell: false,
      windowsHide: true,
      timeout: DEFAULT_TIMEOUT_MS,
    });
    if (result.status !== 0) {
      throw new GitCommandError(
        "--version",
        result.status ?? 1,
        result.stderr || result.error?.message || "git binary was not found",
      );
    }
    return this.binary;
  }

  execGit(request: GitExecRequest): GitExecResult {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...request.env,
      GIT_TERMINAL_PROMPT: "0",
    };
    const args = ["-c", "core.longpaths=true", ...request.args];
    const started = Date.now();
    const result = this.spawn(this.binary, args, {
      cwd: request.cwd,
      env,
      shell: false,
      windowsHide: true,
      timeout: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      ...(request.stdin !== undefined ? { input: request.stdin } : {}),
    });
    return {
      exitCode: result.status ?? 1,
      stdout: result.stdout ?? "",
      stderr: result.stderr || result.error?.message || "",
      durationMs: Date.now() - started,
    };
  }
}

function defaultSpawn(binary: string, args: readonly string[], options: GitSpawnOptions): GitSpawnResult {
  const result = spawnSync(binary, args, {
    cwd: options.cwd,
    input: options.input,
    env: options.env,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: options.timeout,
  });
  return {
    status: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
    ...(result.error ? { error: result.error } : {}),
  };
}

export function stripTrailingNewline(value: string): string {
  return value.replace(/\r?\n$/, "");
}
