import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ResumeError } from "./errors.js";
import { LARGE_WIP_FILE_BYTES, countLines } from "./types.js";

export interface GitResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface DirtySnapshot {
  readonly treeSha: string;
  readonly modifiedFiles: readonly string[];
  readonly headSha: string;
  readonly indexSha256Before: string;
  readonly indexSha256After: string;
}

/**
 * Local port of Task 037 `DirtySnapshotEngine`.
 * The real index is never the `GIT_INDEX_FILE`. Swap for `SnapshotManager` at integration.
 */
export interface DirtySnapshotEngine {
  capture(repoPath: string): DirtySnapshot;
}

export class LocalDirtySnapshotEngine implements DirtySnapshotEngine {
  capture(repoPath: string): DirtySnapshot {
    const before = indexSha256(repoPath);
    const headSha = mustGit(repoPath, ["rev-parse", "HEAD"]).trim();
    const modifiedFiles = dirtyPaths(repoPath);
    const tempDir = path.join(tmpdir(), "ef-harness-resume", randomUUID());
    mkdirSync(tempDir, { recursive: true });
    const indexFile = path.join(tempDir, "index");
    const env = { GIT_INDEX_FILE: indexFile };
    try {
      mustGit(repoPath, ["read-tree", headSha], env);
      mustGit(repoPath, ["add", "-A"], env);
      const treeSha = mustGit(repoPath, ["write-tree"], env).trim();
      const after = indexSha256(repoPath);
      if (before !== after) {
        throw new ResumeError("index_mutated", "Temporary-index snapshot changed .git/index");
      }
      return {
        treeSha,
        modifiedFiles,
        headSha,
        indexSha256Before: before,
        indexSha256After: after,
      };
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

export interface ChangedWorktreeFile {
  readonly path: string;
  readonly status: "A" | "M" | "D";
  readonly bytes: number;
  readonly lines: number;
  readonly excerpt: string | null;
  readonly contradicted: boolean;
}

export interface TreeVerification {
  readonly exists: boolean;
  readonly appliesOnPinnedBase: boolean;
  readonly integrationAdvanced: boolean;
  readonly conflict: boolean;
  readonly mergedTreeSha: string | null;
  readonly note: string | null;
}

export interface GitTreeSafety {
  verify(input: {
    readonly repoPath: string;
    readonly pinnedBaseCommitSha: string;
    readonly wipTreeSha: string;
    readonly integrationSha: string;
  }): TreeVerification;
  integrationHead(repoPath: string): string;
  changedFiles(input: {
    readonly repoPath: string;
    readonly baseCommitSha: string;
    readonly wipTreeSha: string;
    readonly contradictedTokens: readonly string[];
  }): readonly ChangedWorktreeFile[];
  composeTree(input: {
    readonly repoPath: string;
    readonly baseTreeSha: string;
    readonly wipTreeSha: string;
    readonly overlayPaths: readonly string[];
    readonly removePaths: readonly string[];
  }): string;
  treeOfCommit(repoPath: string, commitSha: string): string;
  materialize(repoPath: string, treeSha: string, destination: string): void;
  lsTree(repoPath: string, treeSha: string): readonly string[];
}

const COMMIT_ENV: NodeJS.ProcessEnv = {
  GIT_AUTHOR_NAME: "Harness Kernel",
  GIT_AUTHOR_EMAIL: "kernel@harness.local",
  GIT_COMMITTER_NAME: "Harness Kernel",
  GIT_COMMITTER_EMAIL: "kernel@harness.local",
};

export class LocalGitTreeSafety implements GitTreeSafety {
  integrationHead(repoPath: string): string {
    return mustGit(repoPath, ["rev-parse", "HEAD"]).trim();
  }

  treeOfCommit(repoPath: string, commitSha: string): string {
    return mustGit(repoPath, ["rev-parse", `${commitSha}^{tree}`]).trim();
  }

  verify(input: {
    readonly repoPath: string;
    readonly pinnedBaseCommitSha: string;
    readonly wipTreeSha: string;
    readonly integrationSha: string;
  }): TreeVerification {
    const kind = runGit(input.repoPath, ["cat-file", "-t", input.wipTreeSha]);
    if (kind.status !== 0 || kind.stdout.trim() !== "tree") {
      return {
        exists: false,
        appliesOnPinnedBase: false,
        integrationAdvanced: input.integrationSha !== input.pinnedBaseCommitSha,
        conflict: false,
        mergedTreeSha: null,
        note: `WIP tree ${input.wipTreeSha} is missing from the local object store. Starting from the fresh base.`,
      };
    }
    const onBase = this.mergeTrees(
      input.repoPath,
      input.pinnedBaseCommitSha,
      input.pinnedBaseCommitSha,
      input.wipTreeSha,
    );
    const advanced = input.integrationSha !== input.pinnedBaseCommitSha;
    if (!onBase.clean) {
      return {
        exists: true,
        appliesOnPinnedBase: false,
        integrationAdvanced: advanced,
        conflict: true,
        mergedTreeSha: null,
        note: `WIP tree does not apply cleanly over ${input.pinnedBaseCommitSha}. Starting from the fresh base.`,
      };
    }
    if (!advanced) {
      return {
        exists: true,
        appliesOnPinnedBase: true,
        integrationAdvanced: false,
        conflict: false,
        mergedTreeSha: input.wipTreeSha,
        note: null,
      };
    }
    const ontoIntegration = this.mergeTrees(
      input.repoPath,
      input.pinnedBaseCommitSha,
      input.integrationSha,
      input.wipTreeSha,
    );
    if (!ontoIntegration.clean || !ontoIntegration.treeSha) {
      return {
        exists: true,
        appliesOnPinnedBase: true,
        integrationAdvanced: true,
        conflict: true,
        mergedTreeSha: null,
        note: `harness/integration advanced from ${input.pinnedBaseCommitSha} to ${input.integrationSha} and the WIP diff did not merge cleanly. Starting from the fresh base.`,
      };
    }
    return {
      exists: true,
      appliesOnPinnedBase: true,
      integrationAdvanced: true,
      conflict: false,
      mergedTreeSha: ontoIntegration.treeSha,
      note: `harness/integration advanced from ${input.pinnedBaseCommitSha} to ${input.integrationSha}. WIP rebased cleanly.`,
    };
  }

  changedFiles(input: {
    readonly repoPath: string;
    readonly baseCommitSha: string;
    readonly wipTreeSha: string;
    readonly contradictedTokens: readonly string[];
  }): readonly ChangedWorktreeFile[] {
    const baseTree = this.treeOfCommit(input.repoPath, input.baseCommitSha);
    const diff = runGit(input.repoPath, ["diff", "--name-status", baseTree, input.wipTreeSha]);
    if (diff.status !== 0) return [];
    const needles = input.contradictedTokens.map((token) => token.toLowerCase()).filter((token) => token.length > 0);
    const files: ChangedWorktreeFile[] = [];
    for (const line of diff.stdout.split(/\r?\n/)) {
      if (line.length === 0) continue;
      const parts = line.split("\t");
      const statusText = parts[0] ?? "";
      const marker = statusText.charAt(0);
      const filePath = marker === "R" || marker === "C" ? parts[2] : parts[1];
      if (!filePath) continue;
      const status: ChangedWorktreeFile["status"] = marker === "A" || marker === "D" || marker === "M" ? marker : "M";
      if (status === "D") {
        files.push({
          path: filePath,
          status,
          bytes: 0,
          lines: 0,
          excerpt: null,
          contradicted: false,
        });
        continue;
      }
      const described = describeBlob(input.repoPath, input.wipTreeSha, filePath, needles);
      files.push({
        path: filePath,
        status,
        bytes: described.bytes,
        lines: described.lines,
        excerpt: described.excerpt,
        contradicted: described.contradicted,
      });
    }
    return files;
  }

  composeTree(input: {
    readonly repoPath: string;
    readonly baseTreeSha: string;
    readonly wipTreeSha: string;
    readonly overlayPaths: readonly string[];
    readonly removePaths: readonly string[];
  }): string {
    return withTempIndex(input.repoPath, (env) => {
      mustGit(input.repoPath, ["read-tree", input.baseTreeSha], env);
      for (const filePath of input.removePaths) {
        mustGit(input.repoPath, ["rm", "--cached", "--ignore-unmatch", "--", filePath], env);
      }
      for (const filePath of input.overlayPaths) {
        const listed = runGit(input.repoPath, ["rev-parse", "--verify", `${input.wipTreeSha}:${filePath}`]);
        if (listed.status !== 0) {
          mustGit(input.repoPath, ["rm", "--cached", "--ignore-unmatch", "--", filePath], env);
          continue;
        }
        const blob = listed.stdout.trim();
        mustGit(
          input.repoPath,
          ["update-index", "--add", "--cacheinfo", `100644,${blob},${filePath}`],
          env,
        );
      }
      return mustGit(input.repoPath, ["write-tree"], env).trim();
    });
  }

  materialize(repoPath: string, treeSha: string, destination: string): void {
    rmSync(destination, { recursive: true, force: true });
    mkdirSync(destination, { recursive: true });
    const prefix = destination.replaceAll("\\", "/").replace(/\/?$/, "/");
    withTempIndex(repoPath, (env) => {
      mustGit(repoPath, ["read-tree", treeSha], env);
      mustGit(repoPath, ["checkout-index", "-a", "-f", `--prefix=${prefix}`], env);
      return treeSha;
    });
  }

  lsTree(repoPath: string, treeSha: string): readonly string[] {
    const listed = mustGit(repoPath, ["ls-tree", "-r", "--name-only", treeSha]);
    return listed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  private mergeTrees(
    repoPath: string,
    pinnedBaseCommitSha: string,
    ontoCommit: string,
    wipTreeSha: string,
  ): { readonly clean: boolean; readonly treeSha: string | null } {
    const wipCommit = mustGit(
      repoPath,
      ["commit-tree", wipTreeSha, "-p", pinnedBaseCommitSha, "-m", "wip"],
      COMMIT_ENV,
    ).trim();
    if (ontoCommit === pinnedBaseCommitSha) {
      return { clean: true, treeSha: wipTreeSha };
    }
    const merged = runGit(repoPath, ["merge-tree", "--write-tree", ontoCommit, wipCommit]);
    const treeSha = merged.stdout.split(/\r?\n/).find((line) => /^[0-9a-f]{40}$/.test(line)) ?? null;
    return { clean: merged.status === 0 && treeSha !== null, treeSha: merged.status === 0 ? treeSha : null };
  }
}

function describeBlob(
  repoPath: string,
  treeSha: string,
  filePath: string,
  needles: readonly string[],
): { readonly bytes: number; readonly lines: number; readonly excerpt: string | null; readonly contradicted: boolean } {
  const shown = runGit(repoPath, ["show", `${treeSha}:${filePath}`]);
  if (shown.status !== 0) {
    return { bytes: 0, lines: 0, excerpt: null, contradicted: false };
  }
  const text = shown.stdout;
  const bytes = Buffer.byteLength(text);
  const lines = countLines(text);
  const contradicted = needles.some((token) => text.toLowerCase().includes(token));
  if (bytes >= LARGE_WIP_FILE_BYTES) {
    return { bytes, lines, excerpt: null, contradicted };
  }
  const excerpt = text.length > 400 ? text.slice(0, 400) : text;
  return { bytes, lines, excerpt, contradicted };
}

function dirtyPaths(repoPath: string): string[] {
  const tracked = runGit(repoPath, ["diff", "--name-only", "HEAD"]);
  const untracked = runGit(repoPath, ["ls-files", "--others", "--exclude-standard"]);
  const names = new Set<string>();
  for (const line of `${tracked.stdout}\n${untracked.stdout}`.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) names.add(trimmed);
  }
  return [...names].sort();
}

function indexSha256(repoPath: string): string {
  const gitDir = mustGit(repoPath, ["rev-parse", "--absolute-git-dir"]).trim();
  const indexPath = path.join(gitDir, "index");
  if (!existsSync(indexPath)) return "missing";
  return createHash("sha256").update(readFileSync(indexPath)).digest("hex");
}

function withTempIndex<T>(repoPath: string, body: (env: NodeJS.ProcessEnv) => T): T {
  const tempDir = path.join(tmpdir(), "ef-harness-resume", randomUUID());
  mkdirSync(tempDir, { recursive: true });
  const indexFile = path.join(tempDir, "index");
  try {
    return body({ GIT_INDEX_FILE: indexFile });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export function runGit(repoPath: string, args: readonly string[], env?: NodeJS.ProcessEnv): GitResult {
  const result = spawnSync("git", ["-c", "core.longpaths=true", "-c", "core.autocrlf=false", ...args], {
    cwd: repoPath,
    encoding: "utf8",
    windowsHide: true,
    env: gitEnv(env),
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export function mustGit(repoPath: string, args: readonly string[], env?: NodeJS.ProcessEnv): string {
  const result = runGit(repoPath, args, env);
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || "no output";
    throw new ResumeError("git", `git ${args.join(" ")} failed: ${detail}`);
  }
  return result.stdout;
}

function gitEnv(extra: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (!extra) return env;
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}
