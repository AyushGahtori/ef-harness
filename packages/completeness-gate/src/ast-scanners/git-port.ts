import { spawn } from "node:child_process";
import type { GitExecResult, GitRunnerPort } from "./types.js";

const READ_ONLY_COMMANDS = new Set(["diff", "show", "rev-parse", "status", "log", "ls-tree", "cat-file"]);

/**
 * Process-local stand-in for Task 035 `GitRunner`.
 * Swap for `GitRunner.execGit` once `@ef-harness/git-engine` exports it.
 * Only read-only subcommands are issued, with `shell: false`.
 */
export function createProcessGitRunner(): GitRunnerPort {
  return {
    execGit(args, options) {
      const command = args[0];
      if (!command || !READ_ONLY_COMMANDS.has(command)) {
        return Promise.resolve({
          exitCode: 128,
          stdout: "",
          stderr: `refusing non-read-only git command: ${command ?? ""}`,
          durationMs: 0,
        });
      }
      return runGit(args, options.cwd, options.timeoutMs ?? 15_000);
    },
  };
}

function runGit(args: readonly string[], cwd: string, timeoutMs: number): Promise<GitExecResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(
      "git",
      ["-c", "core.longpaths=true", "-c", "core.quotepath=false", ...args],
      {
        cwd,
        shell: false,
        windowsHide: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      },
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    const finish = (result: GitExecResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({
        exitCode: 124,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: "git command timed out",
        durationMs: Date.now() - started,
      });
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      finish({
        exitCode: 127,
        stdout: "",
        stderr: error.message,
        durationMs: Date.now() - started,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        durationMs: Date.now() - started,
      });
    });
  });
}
