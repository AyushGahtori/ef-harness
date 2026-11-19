import fs from "node:fs/promises";
import path from "node:path";
import { GitCommandFailedError, SlotBusyError } from "./errors.js";
import type { GitExecResult, GitRunOptions, GitRunner } from "./git-runner.js";
import { SLOT_OWNER_MARKER_FILE, WARM_DEPENDENCY_EXCLUDES } from "./types.js";

export function gitOptions(cwd: string, consentToken: string | undefined): GitRunOptions {
  if (consentToken !== undefined) {
    return { cwd, userExplicitConsentToken: consentToken };
  }
  return { cwd };
}

export function isTransientBusy(result: GitExecResult): boolean {
  if (result.exitCode === 0) return false;
  const text = `${result.stderr}\n${result.stdout}`;
  return /EBUSY|EPERM|resource busy|being used by another process|Permission denied/i.test(text);
}

export async function gitOk(
  git: GitRunner,
  args: readonly string[],
  cwd: string,
  consentToken: string | undefined,
): Promise<GitExecResult> {
  const result = await git.execGit(args, gitOptions(cwd, consentToken));
  if (result.exitCode !== 0) throw new GitCommandFailedError(args, result);
  return result;
}

export async function gitRetry(
  git: GitRunner,
  args: readonly string[],
  cwd: string,
  consentToken: string | undefined,
  sleep: (ms: number) => Promise<void>,
  attempts: number,
  baseDelayMs: number,
): Promise<GitExecResult> {
  let last: GitExecResult | null = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await git.execGit(args, gitOptions(cwd, consentToken));
    if (!isTransientBusy(result)) {
      if (result.exitCode !== 0) throw new GitCommandFailedError(args, result);
      return result;
    }
    last = result;
    if (attempt < attempts) await sleep(baseDelayMs * 2 ** (attempt - 1));
  }
  throw new SlotBusyError(args, last ?? { exitCode: 1, stdout: "", stderr: "EBUSY", durationMs: 0 });
}

export function cleanArgs(extraExcludes: readonly string[]): string[] {
  const args = ["clean", "-fd"];
  const excludes = new Set<string>([SLOT_OWNER_MARKER_FILE, ...WARM_DEPENDENCY_EXCLUDES, ...extraExcludes]);
  for (const exclude of excludes) {
    if (
      exclude.length === 0 ||
      exclude.startsWith("-") ||
      exclude.includes("\0") ||
      exclude.includes("..") ||
      exclude.includes("/") ||
      exclude.includes("\\")
    ) {
      throw new Error(`refusing git clean exclude pattern: ${exclude}`);
    }
    args.push("-e", exclude);
  }
  return args;
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch (error) {
    if (isEnoent(error)) return false;
    throw error;
  }
}

export function samePath(left: string, right: string): boolean {
  return path.resolve(left).replaceAll("\\", "/").toLowerCase() === path.resolve(right).replaceAll("\\", "/").toLowerCase();
}

export function attemptBranchName(taskId: string, attempt: string): string {
  return `harness/t/${taskId}/${attempt}`;
}

export function assertSafeBranchPiece(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) {
    throw new Error(`${label} must be a short safe token, received ${JSON.stringify(value)}`);
  }
}

export function assertSafeRelativePath(value: string, label: string): void {
  const normalized = value.replaceAll("\\", "/");
  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error(`${label} must be a relative path without '..': ${value}`);
  }
}

export async function rmWithRetry(
  target: string,
  sleep: (ms: number) => Promise<void>,
  attempts: number,
  baseDelayMs: number,
): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await fs.rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = errnoCode(error);
      if (code === "ENOENT") return;
      if ((code === "EBUSY" || code === "EPERM" || code === "ENOTEMPTY") && attempt < attempts) {
        await sleep(baseDelayMs * 2 ** (attempt - 1));
        continue;
      }
      if (code === "EBUSY" || code === "EPERM") {
        throw new SlotBusyError(["rm", target], {
          exitCode: 1,
          stdout: "",
          stderr: `${code}: ${target}`,
          durationMs: 0,
        });
      }
      throw error;
    }
  }
}

export function parseWorktreePorcelain(stdout: string): { path: string; branch: string | null; detached: boolean }[] {
  const items: { path: string; branch: string | null; detached: boolean }[] = [];
  let current: { path: string; branch: string | null; detached: boolean } | null = null;
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      if (current) items.push(current);
      current = { path: line.slice("worktree ".length), branch: null, detached: false };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("branch ")) current.branch = line.slice("branch ".length);
    if (line === "detached") current.detached = true;
  }
  if (current) items.push(current);
  return items;
}

export function latestCheckpointRef(stdout: string, taskId: string): { sha: string; ref: string } | null {
  const prefix = `refs/harness/checkpoints/${taskId}/`;
  let best: { sha: string; ref: string; n: number } | null = null;
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = /^([0-9a-f]{40}) (refs\/harness\/checkpoints\/\S+)$/.exec(trimmed);
    if (!match) continue;
    const sha = match[1];
    const ref = match[2];
    if (!sha || !ref || !ref.startsWith(prefix)) continue;
    const suffix = ref.slice(prefix.length);
    const n = /^\d+$/.test(suffix) ? Number(suffix) : -1;
    if (!best || n > best.n) best = { sha, ref, n };
  }
  if (!best) return null;
  return { sha: best.sha, ref: best.ref };
}

function isEnoent(error: unknown): boolean {
  return errnoCode(error) === "ENOENT";
}

function errnoCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return undefined;
}
