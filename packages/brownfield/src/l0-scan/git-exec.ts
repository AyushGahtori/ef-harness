import { spawnSync } from "node:child_process";

export interface GitRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface MinGitCommandRunner {
  run(args: readonly string[], cwd: string): GitRunResult;
}

function splitNul(stdout: string): string[] {
  const trimmed = stdout.endsWith("\0") ? stdout.slice(0, -1) : stdout;
  if (!trimmed) return [];
  return trimmed.split("\0").filter(Boolean);
}

export function createNodeGitRunner(): MinGitCommandRunner {
  return {
    run(args, cwd) {
      const result = spawnSync("git", [...args], {
        cwd,
        encoding: "utf8",
        windowsHide: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
      return {
        exitCode: result.status ?? 1,
        stdout: result.stdout ?? "",
        stderr: (result.stderr ?? "").replace(/\0/g, ""),
      };
    },
  };
}

export function gitOk(runner: MinGitCommandRunner, cwd: string, args: readonly string[]): string | null {
  const result = runner.run(args, cwd);
  if (result.exitCode !== 0) return null;
  return result.stdout.trimEnd();
}

/** Local port of Task 035 `MinGitRepoInspector` git surface used by L0. */
export interface MinGitRepoInspectorPort {
  readonly runner: MinGitCommandRunner;
  isGitRepo(root: string): boolean;
  headSha(root: string): string | null;
  lsFiles(root: string): readonly string[];
  lsOthers(root: string): readonly string[];
  logLastCommitForFile(root: string, file: string): string | null;
}

export function createMinGitRepoInspector(runner: MinGitCommandRunner = createNodeGitRunner()): MinGitRepoInspectorPort {
  return {
    runner,
    isGitRepo(root) {
      return gitOk(runner, root, ["rev-parse", "--git-dir"]) !== null;
    },
    headSha(root) {
      return gitOk(runner, root, ["rev-parse", "HEAD"]);
    },
    lsFiles(root) {
      const out = gitOk(runner, root, ["ls-files", "-z", "--cached", "--exclude-standard"]);
      if (!out) return [];
      return splitNul(out);
    },
    lsOthers(root) {
      const out = gitOk(runner, root, ["ls-files", "-z", "--others", "--exclude-standard"]);
      if (!out) return [];
      return splitNul(out);
    },
    logLastCommitForFile(root, file) {
      return gitOk(runner, root, ["log", "-1", "--format=%cI", "--", file]);
    },
  };
}