import { spawn } from "node:child_process";
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
 * In-scope adapter for Task 035 `GitRunner` until that module is wired into this branch.
 * Spawns Git directly (`shell: false`, `windowsHide: true`) and never removes a lock file.
 */
export function createProcessSnapshotGitRunner(
  options: ProcessSnapshotGitRunnerOptions = {},
): SnapshotGitRunner {
  const gitBinary = options.gitBinary ?? "git";
  const defaultTimeoutMs = options.timeoutMs ?? 60_000;
  return {
    async execGit(request: SnapshotGitRequest): Promise<SnapshotGitResult> {
      assertLineEndingsPreserved(request.args);
      assertConsent(request);
      const command = extractSubcommand(request.args);
      if (command !== null && command.toLowerCase() === "stash") {
        throw new SnapshotConsentRequiredError("stash");
      }
      const timeoutMs = request.timeoutMs ?? defaultTimeoutMs;
      const args = ["-c", "core.longpaths=true", "-c", "core.quotepath=false", ...request.args];
      const env: NodeJS.ProcessEnv = {
        ...(request.env ?? process.env),
        GIT_TERMINAL_PROMPT: "0",
        GCM_INTERACTIVE: "Never",
      };
      const started = performance.now();
      return await new Promise((resolve, reject) => {
        let settled = false;
        let stdout = "";
        let stderr = "";
        let timedOut = false;
        const child = spawn(request.gitBinary ?? gitBinary, args, {
          cwd: request.cwd,
          env,
          shell: false,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill();
        }, timeoutMs);
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          stdout += chunk;
        });
        child.stderr.on("data", (chunk: string) => {
          stderr += chunk;
        });
        const finish = (exitCode: number | null) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const timeoutNote = timedOut ? `Git command timed out after ${timeoutMs} ms.` : "";
          resolve({
            exitCode,
            stdout,
            stderr: timeoutNote ? `${stderr}${stderr ? "\n" : ""}${timeoutNote}` : stderr,
            durationMs: Math.max(0, Math.round(performance.now() - started)),
          });
        };
        child.on("error", (error: NodeJS.ErrnoException) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (error.code === "ENOENT") {
            reject(new Error(`git binary not found: ${request.gitBinary ?? gitBinary}`));
            return;
          }
          reject(error);
        });
        child.on("close", (code) => {
          finish(code);
        });
      });
    },
  };
}
