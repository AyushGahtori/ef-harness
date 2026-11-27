import { execGit as runCanonicalGit } from "../runner/exec-git.js";
import { resolveGitBinary as resolveCanonicalGitBinary } from "../runner/resolve-binary.js";

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
 * Ref updates go through the canonical `GitRunner.execGit`.
 * `update-ref` and `commit-tree` target harness refs, so the developer-checkout
 * guard stays off while the C14 binary resolver, prompt lock, and stdin pipe stay on.
 */
export interface GitRunner {
  resolveGitBinary(): Promise<string>;
  execGit(request: GitExecRequest): Promise<GitExecResult>;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export function createDirectGitRunner(options?: {
  readonly gitBinary?: string;
  readonly timeoutMs?: number;
}): GitRunner {
  const gitBinary = options?.gitBinary;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    async resolveGitBinary() {
      if (gitBinary !== undefined) return gitBinary;
      const resolved = await resolveCanonicalGitBinary({ timeoutMs });
      return resolved.gitPath;
    },
    async execGit(request) {
      const result = await runCanonicalGit({
        args: request.args,
        cwd: request.cwd,
        timeoutMs: request.timeoutMs ?? timeoutMs,
        developerCheckout: false,
        ...(gitBinary !== undefined ? { gitBinary } : {}),
        ...(request.stdin !== undefined ? { stdin: request.stdin } : {}),
        ...(request.env !== undefined ? { env: overlayEnv(request.env) } : {}),
      });
      return {
        exitCode: result.exitCode ?? 1,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: result.durationMs,
      };
    },
  };
}

function overlayEnv(env: Readonly<NodeJS.ProcessEnv>): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete merged[key];
    else merged[key] = value;
  }
  return merged;
}

export function stripTrailingNewline(value: string): string {
  return value.replace(/\r?\n$/, "");
}
