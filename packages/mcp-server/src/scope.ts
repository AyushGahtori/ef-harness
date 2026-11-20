import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function normalizeRepoPath(file: string): string {
  return file.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

/**
 * Match a task-packet write-scope glob.
 * `**` crosses path segments, `*` and `?` stay inside one segment.
 */
export function globMatch(pattern: string, value: string): boolean {
  const normalizedPattern = normalizeRepoPath(pattern);
  const normalizedValue = normalizeRepoPath(value);
  let expression = "";
  for (let index = 0; index < normalizedPattern.length; index += 1) {
    const char = normalizedPattern[index];
    const next = normalizedPattern[index + 1];
    if (char === "*" && next === "*") {
      expression += ".*";
      index += 1;
      continue;
    }
    if (char === "*") {
      expression += "[^/]*";
      continue;
    }
    if (char === "?") {
      expression += "[^/]";
      continue;
    }
    if (char !== undefined && /[.+^${}()|[\]\\]/.test(char)) {
      expression += `\\${char}`;
      continue;
    }
    expression += char ?? "";
  }
  return new RegExp(`^${expression}$`).test(normalizedValue);
}

export function pathInWriteScope(file: string, globs: readonly string[]): boolean {
  const normalized = normalizeRepoPath(file);
  return globs.some((pattern) => globMatch(pattern, normalized));
}

export function outsideWriteScope(files: readonly string[], globs: readonly string[]): string[] {
  const outside: string[] = [];
  for (const file of files) {
    if (!pathInWriteScope(file, globs)) outside.push(normalizeRepoPath(file));
  }
  return outside;
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync("git", [...args], {
    cwd,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
    env: process.env,
  });
  return result.stdout;
}

/**
 * Authoritative changed paths from the worktree.
 * `git diff --name-only <base>` is the tracked ground truth.
 * Untracked files are included so a new out-of-scope file cannot hide.
 */
export async function readGitChangedPaths(worktreePath: string, baseCommit: string): Promise<string[]> {
  const tracked = await git(worktreePath, ["diff", "--name-only", "--relative", baseCommit]);
  const untracked = await git(worktreePath, ["ls-files", "--others", "--exclude-standard"]);
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const line of `${tracked}\n${untracked}`.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const normalized = normalizeRepoPath(trimmed.replaceAll('"', ""));
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    paths.push(normalized);
  }
  return paths;
}

export interface SnapshotInput {
  worktreePath: string;
  baseCommit: string;
  changedPaths: readonly string[];
  attemptId: string;
}

/**
 * Kernel snapshot of the in-scope diff. Identity is passed only to this
 * command and is not written to git config.
 */
export async function snapshotWorktreeDiff(input: SnapshotInput): Promise<{ commitSha: string }> {
  if (input.changedPaths.length > 0) {
    await execFileAsync("git", ["add", "--", ...input.changedPaths], {
      cwd: input.worktreePath,
      windowsHide: true,
      env: process.env,
    });
  }
  await execFileAsync(
    "git",
    [
      "-c",
      "user.name=EF Harness",
      "-c",
      "user.email=harness@example.com",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--allow-empty",
      "-m",
      `harness snapshot ${input.attemptId}`,
    ],
    {
      cwd: input.worktreePath,
      windowsHide: true,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "EF Harness",
        GIT_AUTHOR_EMAIL: "harness@example.com",
        GIT_COMMITTER_NAME: "EF Harness",
        GIT_COMMITTER_EMAIL: "harness@example.com",
      },
    },
  );
  const sha = (await git(input.worktreePath, ["rev-parse", "HEAD"])).trim();
  return { commitSha: sha };
}
