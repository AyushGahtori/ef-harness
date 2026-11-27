import { execGit as runCanonicalGit } from "../runner/exec-git.js";
import { LineEndingOverrideError, SnapshotConsentRequiredError } from "./errors.js";
import type { SnapshotGitRequest, SnapshotGitResult, SnapshotGitRunner } from "./types.js";

const READ_ONLY = new Set([
  "status",
  "rev-parse",
  "symbolic-ref",
  "diff",
  "merge-tree",
  "log",
  "ls-tree",
  "ls-files",
  "for-each-ref",
  "cat-file",
  "show-ref",
  "rev-list",
  "version",
  "help",
  "config",
]);

const VALUE_GLOBAL_OPTIONS = new Set([
  "-c",
  "-C",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--super-prefix",
  "--config-env",
  "--exec-path",
]);

export interface ProcessSnapshotGitRunnerOptions {
  readonly gitBinary?: string;
  readonly timeoutMs?: number;
}

function extractSubcommand(args: readonly string[]): string | null {
  let index = 0;
  while (index < args.length) {
    const arg = args[index] ?? "";
    if (arg === "--") return null;
    if (VALUE_GLOBAL_OPTIONS.has(arg)) {
      index += 2;
      continue;
    }
    if (arg.startsWith("-c") && arg.length > 2) {
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) {
      index += 1;
      continue;
    }
    return arg;
  }
  return null;
}

function assertLineEndingsPreserved(args: readonly string[]): void {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg === "-c" || arg === "--config-env") {
      const value = args[index + 1] ?? "";
      if (/core\.autocrlf/i.test(value)) throw new LineEndingOverrideError();
    } else if (/core\.autocrlf/i.test(arg)) {
      throw new LineEndingOverrideError();
    }
  }
}

function assertConsent(request: SnapshotGitRequest): void {
  const command = extractSubcommand(request.args);
  if (command === null) return;
  const developerCheckout = request.developerCheckout ?? true;
  if (!developerCheckout) return;
  if (READ_ONLY.has(command)) return;
  const token = request.userExplicitConsentToken?.trim() ?? "";
  if (token.length > 0) return;
  throw new SnapshotConsentRequiredError(command);
}

/**
 * Adapter onto the canonical `GitRunner.execGit`.
 * Keeps snapshot consent and line-ending errors, then runs through the shared runner.
 */
export function createProcessSnapshotGitRunner(
  options: ProcessSnapshotGitRunnerOptions = {},
): SnapshotGitRunner {
  const gitBinary = options.gitBinary;
  const defaultTimeoutMs = options.timeoutMs ?? 60_000;
  return {
    async execGit(request: SnapshotGitRequest): Promise<SnapshotGitResult> {
      assertLineEndingsPreserved(request.args);
      assertConsent(request);
      const command = extractSubcommand(request.args);
      if (command !== null && command.toLowerCase() === "stash") {
        throw new SnapshotConsentRequiredError("stash");
      }
      const binary = request.gitBinary ?? gitBinary;
      const consent = request.userExplicitConsentToken;
      const result = await runCanonicalGit({
        args: request.args,
        cwd: request.cwd,
        timeoutMs: request.timeoutMs ?? defaultTimeoutMs,
        ...(request.env !== undefined ? { env: request.env } : {}),
        ...(binary !== undefined ? { gitBinary: binary } : {}),
        ...(request.developerCheckout !== undefined ? { developerCheckout: request.developerCheckout } : {}),
        ...(consent !== undefined ? { userExplicitConsentToken: consent } : {}),
      });
      return {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: result.durationMs,
      };
    },
  };
}
