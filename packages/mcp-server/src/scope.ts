import { GitRunner } from "@ef-harness/git-engine";

export function normalizeRepoPath(file: string): string {
  return file.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

/**
 * Match a task-packet write-scope glob.
 * `**` crosses path segments (including zero segments for `/**\/` and leading `**\/`),
 * while `*` and `?` stay inside one segment.
 */
export function globMatch(pattern: string, value: string): boolean {
  const normalizedPattern = normalizeRepoPath(pattern);
  const normalizedValue = normalizeRepoPath(value);
  let expression = "";
  for (let index = 0; index < normalizedPattern.length; index += 1) {
    if (index === 0 && normalizedPattern.startsWith("**/")) {
      expression += "(?:.*/)?";
      index += 2;
      continue;
    }
    if (normalizedPattern.startsWith("/**/", index)) {
      while (normalizedPattern.startsWith("/**/**/", index)) {
        index += 3;
      }
      expression += "(?:/|/.*/)";
      index += 3;
      continue;
    }
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

function commitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  env.GIT_AUTHOR_NAME = "EF Harness";
  env.GIT_AUTHOR_EMAIL = "harness@example.com";
  env.GIT_COMMITTER_NAME = "EF Harness";
  env.GIT_COMMITTER_EMAIL = "harness@example.com";
  return env;
}

async function git(input: {
  cwd: string;
  args: readonly string[];
  developerCheckout: boolean;
  env?: NodeJS.ProcessEnv;
}): Promise<string> {
  const result = await GitRunner.execGit({
    cwd: input.cwd,
    args: [...input.args],
    developerCheckout: input.developerCheckout,
    ...(input.env ? { env: input.env } : {}),
  });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || result.busyMessage || "git command failed");
  }
  return result.stdout;
}

/**
 * Authoritative changed paths from the worktree.
 * `git diff --name-only <base>` is the tracked ground truth.
 * Untracked files are included so a new out-of-scope file cannot hide.
 */
export async function readGitChangedPaths(worktreePath: string, baseCommit: string): Promise<string[]> {
  const tracked = await git({
    cwd: worktreePath,
    args: ["-c", "core.quotepath=false", "diff", "--name-only", "--relative", baseCommit],
    developerCheckout: true,
  });
  const untracked = await git({
    cwd: worktreePath,
    args: ["-c", "core.quotepath=false", "ls-files", "--others", "--exclude-standard"],
    developerCheckout: true,
  });
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
    await git({
      cwd: input.worktreePath,
      args: ["add", "--", ...input.changedPaths],
      developerCheckout: false,
    });
  }
  await git({
    cwd: input.worktreePath,
    developerCheckout: false,
    env: commitEnv(),
    args: [
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
  });
  const sha = (
    await git({
      cwd: input.worktreePath,
      args: ["rev-parse", "HEAD"],
      developerCheckout: true,
    })
  ).trim();
  return { commitSha: sha };
}
