import { spawnSync } from "node:child_process";
import fs from "node:fs";

export interface CommandResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

export function runCommand(
  command: string,
  args: readonly string[],
  cwd: string,
  input?: string,
): CommandResult {
  const result = spawnSync(command, [...args], {
    cwd,
    input,
    encoding: "utf8",
    windowsHide: true,
    env: process.env,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: `${result.stderr ?? ""}${result.error ? `\n${result.error.message}` : ""}`,
  };
}

export function git(args: readonly string[], cwd: string, input?: string): string {
  const result = runCommand(
    "git",
    ["-c", "commit.gpgsign=false", "-c", "user.name=EF Harness", "-c", "user.email=foundation@ef-harness.local", ...args],
    cwd,
    input,
  );
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

export function gitAllowFail(args: readonly string[], cwd: string): CommandResult {
  return runCommand(
    "git",
    ["-c", "commit.gpgsign=false", "-c", "user.name=EF Harness", "-c", "user.email=foundation@ef-harness.local", ...args],
    cwd,
  );
}

export function listedFiles(repo: string): string[] {
  return git(["ls-files"], repo)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function removeTree(target: string): void {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      if (!fs.existsSync(target)) return;
    } catch {
      block(40 * (attempt + 1));
    }
  }
}

function block(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
