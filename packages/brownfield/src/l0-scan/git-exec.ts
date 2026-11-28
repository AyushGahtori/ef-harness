import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scrubGitEnv } from "@ef-harness/git-engine";

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

let cachedBinary: string | undefined;

/**
 * Resolve the git binary through `@ef-harness/git-engine` `resolveGitBinary`
 * (bundled MinGit, then the unpackaged fallback that resolver already defines).
 */
export function resolveHermeticGitBinary(): string {
  if (cachedBinary) return cachedBinary;
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const script = [
    'import { resolveGitBinary } from "@ef-harness/git-engine";',
    "const resolved = await resolveGitBinary();",
    "process.stdout.write(resolved.gitPath);",
  ].join("\n");
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: packageRoot,
    encoding: "utf8",
    windowsHide: true,
    env: scrubGitEnv(process.env),
  });
  const gitPath = (result.stdout ?? "").trim();
  if (result.status !== 0 || gitPath.length === 0) {
    const detail = (result.stderr ?? "").trim();
    throw new Error(detail.length > 0 ? detail : "hermetic MinGit binary was not resolved");
  }
  cachedBinary = gitPath;
  return gitPath;
}

export function createNodeGitRunner(): MinGitCommandRunner {
  return {
    run(args, cwd) {
      const binary = resolveHermeticGitBinary();
      const result = spawnSync(binary, [...args], {
        cwd,
        encoding: "utf8",
        windowsHide: true,
        env: scrubGitEnv(process.env),
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
  statusPaths(root: string): readonly string[];
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
    statusPaths(root) {
      const out = gitOk(runner, root, ["status", "--porcelain"]);
      if (out === null) return [];
      const paths: string[] = [];
      for (const line of out.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const rel = line.slice(3).trim().replace(/^"(.*)"$/, "$1");
        if (rel) paths.push(rel);
      }
      return paths;
    },
  };
}
