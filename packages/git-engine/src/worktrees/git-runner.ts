import { execGit as runCanonicalGit } from "../runner/exec-git.js";
import { resolveGitBinary as resolveCanonicalGitBinary } from "../runner/resolve-binary.js";

/**
 * Worktree commands go through the canonical `GitRunner.execGit`.
 * Slot directories are harness-managed copies, so the developer-checkout
 * mutation guard stays off here and the C14 binary resolver still applies.
 */
export interface GitExecResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}

export interface GitRunOptions {
  readonly cwd: string;
  readonly timeoutMs?: number;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly userExplicitConsentToken?: string;
}

export interface GitRunner {
  execGit(args: readonly string[], options: GitRunOptions): Promise<GitExecResult>;
  resolveGitBinary(): Promise<string>;
}

export interface ProcessGitRunnerOptions {
  readonly gitBinary?: string;
  readonly timeoutMs?: number;
}

export function createProcessGitRunner(options: ProcessGitRunnerOptions = {}): GitRunner {
  const gitBinary = options.gitBinary;
  const defaultTimeoutMs = options.timeoutMs ?? 180_000;
  return {
    async resolveGitBinary() {
      if (gitBinary !== undefined) return gitBinary;
      const resolved = await resolveCanonicalGitBinary({ timeoutMs: defaultTimeoutMs });
      return resolved.gitPath;
    },
    async execGit(args, run) {
      const consent = run.userExplicitConsentToken;
      const result = await runCanonicalGit({
        args,
        cwd: run.cwd,
        timeoutMs: run.timeoutMs ?? defaultTimeoutMs,
        developerCheckout: false,
        ...(gitBinary !== undefined ? { gitBinary } : {}),
        ...(consent !== undefined ? { userExplicitConsentToken: consent } : {}),
        ...(run.env !== undefined ? { env: overlayEnv(run.env) } : {}),
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

function overlayEnv(env: Readonly<Record<string, string | undefined>>): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete merged[key];
    else merged[key] = value;
  }
  return merged;
}
