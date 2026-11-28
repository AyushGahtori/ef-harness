import { spawnSync } from "node:child_process";

export interface GitRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface MinGitCommandRunner {
  run(args: readonly string[], cwd: string): GitRunResult;
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

function gitOk(runner: MinGitCommandRunner, cwd: string, args: readonly string[]): string | null {
  const result = runner.run(args, cwd);
  if (result.exitCode !== 0) return null;
  return result.stdout.trimEnd();
}

/** Read-only git surface for coexistence (local port of Task 035 `MinGitRepoInspector`). */
export interface MinGitRepoInspectorPort {
  readonly runner: MinGitCommandRunner;
  headSha(repoRoot: string): string | null;
  symbolicRef(repoRoot: string, ref: string): string | null;
  readRef(repoRoot: string, ref: string): string | null;
  isAncestor(repoRoot: string, ancestor: string, descendant: string): boolean;
  deletedPathsSince(repoRoot: string, sinceSha: string, untilSha: string): readonly string[];
  porcelainStatus(repoRoot: string): string;
}

export function createMinGitRepoInspector(
  runner: MinGitCommandRunner = createNodeGitRunner(),
): MinGitRepoInspectorPort {
  return {
    runner,
    headSha(repoRoot) {
      return gitOk(runner, repoRoot, ["rev-parse", "HEAD"]);
    },
    symbolicRef(repoRoot, ref) {
      const out = gitOk(runner, repoRoot, ["symbolic-ref", ref]);
      if (!out) return null;
      return out.replace(/^refs\/heads\//, "");
    },
    readRef(repoRoot, ref) {
      return gitOk(runner, repoRoot, ["rev-parse", ref]);
    },
    isAncestor(repoRoot, ancestor, descendant) {
      const result = runner.run(["merge-base", "--is-ancestor", ancestor, descendant], repoRoot);
      return result.exitCode === 0;
    },
    deletedPathsSince(repoRoot, sinceSha, untilSha) {
      const out = gitOk(runner, repoRoot, [
        "diff",
        "--name-only",
        "--diff-filter=D",
        `${sinceSha}..${untilSha}`,
      ]);
      if (!out) return [];
      return out
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    },
    porcelainStatus(repoRoot) {
      const out = gitOk(runner, repoRoot, ["status", "--porcelain=v1"]);
      return out ?? "";
    },
  };
}