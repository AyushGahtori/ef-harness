import fs from "node:fs";
import path from "node:path";
import {
  assertLineEndingsPreserved,
  assertNeverMutatesDeveloperCheckout,
  buildGitArgs,
  extractSubcommand,
  isStatusCommand,
} from "./classify.js";
import { normalizeRepoPath, scrubGitEnv } from "./paths.js";
import { runProcess } from "./process-runner.js";
import { ensureSupportedGit, resolveGitBinary } from "./resolve-binary.js";
import {
  GIT_BUSY_MESSAGE,
  GitBinaryNotFoundError,
  type ExecGitOptions,
  type ExecGitResult,
} from "./types.js";

const LOCK_RETRY_DELAYS_MS = [40, 80, 120, 160];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isIndexLockFailure(stderr: string): boolean {
  return /index\.lock|another git process seems to be running/i.test(stderr);
}

async function indexLockPath(
  gitPath: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<string | null> {
  const result = await runProcess({
    binary: gitPath,
    args: buildGitArgs(["rev-parse", "--git-path", "index.lock"]),
    cwd,
    env,
    timeoutMs: Math.min(timeoutMs, 10_000),
  });
  if (result.exitCode !== 0) return null;
  const printed = result.stdout.trim().replaceAll('"', "");
  if (!printed) return null;
  return path.resolve(cwd, printed);
}

async function indexLockHeld(
  gitPath: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<boolean> {
  const lockPath = await indexLockPath(gitPath, cwd, env, timeoutMs);
  if (!lockPath) return false;
  // Read the lock's existence only. Never delete a developer's index.lock.
  return fs.existsSync(lockPath);
}

function busyResult(gitPath: string, argv: readonly string[], started: number): ExecGitResult {
  return {
    exitCode: null,
    stdout: "",
    stderr: GIT_BUSY_MESSAGE,
    durationMs: Math.max(0, Math.round(performance.now() - started)),
    timedOut: false,
    busyMessage: GIT_BUSY_MESSAGE,
    gitPath,
    argv,
  };
}

function toResult(
  gitPath: string,
  argv: readonly string[],
  result: {
    exitCode: number | null;
    stdout: string;
    stderr: string;
    durationMs: number;
    timedOut: boolean;
  },
  busy: boolean,
): ExecGitResult {
  return {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: busy && !result.stderr.includes(GIT_BUSY_MESSAGE) ? `${result.stderr}\n${GIT_BUSY_MESSAGE}`.trim() : result.stderr,
    durationMs: result.durationMs,
    timedOut: result.timedOut,
    busyMessage: busy ? GIT_BUSY_MESSAGE : null,
    gitPath,
    argv,
  };
}

export async function execGit(options: ExecGitOptions): Promise<ExecGitResult> {
  if (options.args.length === 0) {
    throw new Error("execGit requires a git argument list.");
  }
  assertLineEndingsPreserved(options.args);
  const cwdStatPath = normalizeRepoPath(options.cwd);
  if (!fs.existsSync(cwdStatPath) || !fs.statSync(cwdStatPath).isDirectory()) {
    throw new Error(`Git working directory does not exist: ${options.cwd}`);
  }
  const developerCheckout = options.developerCheckout ?? true;
  const consent = options.userExplicitConsentToken;
  assertNeverMutatesDeveloperCheckout({
    args: options.args,
    developerCheckout,
    ...(consent !== undefined ? { userExplicitConsentToken: consent } : {}),
  });

  const env = scrubGitEnv(options.env ?? process.env);
  const timeoutMs = options.timeoutMs ?? 30_000;
  const resolved = options.gitBinary
    ? null
    : await resolveGitBinary({
        ...(options.resourcesRoot !== undefined ? { resourcesRoot: options.resourcesRoot } : {}),
        ...(options.settingsGitPath !== undefined ? { settingsGitPath: options.settingsGitPath } : {}),
        env,
        ...(options.logger !== undefined ? { logger: options.logger } : {}),
        timeoutMs,
      });
  const gitPath = options.gitBinary ?? resolved?.gitPath;
  if (!gitPath) {
    throw new GitBinaryNotFoundError("No Git binary was resolved.");
  }
  await ensureSupportedGit(gitPath, env, Math.min(timeoutMs, 15_000));

  const argv = buildGitArgs(options.args);
  assertLineEndingsPreserved(argv);
  const started = performance.now();
  const retries = options.maxLockRetries ?? LOCK_RETRY_DELAYS_MS.length;
  const statusCommand = isStatusCommand(options.args);

  if (statusCommand) {
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const held = await indexLockHeld(gitPath, cwdStatPath, env, timeoutMs);
      if (!held) break;
      if (attempt === retries) {
        options.logger?.warn(GIT_BUSY_MESSAGE, { command: "status", cwd: cwdStatPath });
        return busyResult(gitPath, argv, started);
      }
      await sleep(LOCK_RETRY_DELAYS_MS[attempt] ?? 100);
    }
  }

  let attempt = 0;
  while (true) {
    const result = await runProcess({
      binary: gitPath,
      args: argv,
      cwd: cwdStatPath,
      env,
      timeoutMs,
      ...(options.stdin !== undefined ? { stdin: options.stdin } : {}),
    });
    if (result.spawnError?.code === "ENOENT") {
      throw new GitBinaryNotFoundError(`Git binary was not found: ${gitPath}`);
    }
    if (result.spawnError) {
      throw result.spawnError;
    }
    const lockFailure = statusCommand && isIndexLockFailure(result.stderr);
    if (lockFailure && attempt < retries) {
      attempt += 1;
      await sleep(LOCK_RETRY_DELAYS_MS[attempt - 1] ?? 100);
      continue;
    }
    const structured = toResult(gitPath, argv, result, lockFailure);
    const command = extractSubcommand(options.args).command ?? "git";
    const fields = {
      command,
      exitCode: structured.exitCode === null ? "null" : String(structured.exitCode),
      durationMs: structured.durationMs,
      timedOut: structured.timedOut,
      busy: structured.busyMessage !== null,
    };
    if (structured.busyMessage || structured.timedOut || (structured.exitCode !== null && structured.exitCode !== 0)) {
      options.logger?.warn("git command finished", fields);
    } else {
      options.logger?.info("git command finished", fields);
    }
    return structured;
  }
}
