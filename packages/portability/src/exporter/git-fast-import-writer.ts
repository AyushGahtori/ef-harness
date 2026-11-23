import { spawnSync } from "node:child_process";

import type { FastImportFileOp, MinGitRepoInspectorPort } from "./types.js";
import { HARNESS_STATE_BRANCH } from "./types.js";

export interface FastImportResult {
  readonly commitSha: string | null;
  readonly noop: boolean;
  readonly durationMs: number;
}

function writeBlob(repoPath: string, content: string): string {
  const result = spawnSync("git", ["hash-object", "-w", "--stdin"], {
    cwd: repoPath,
    input: content,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`git hash-object failed: ${result.stderr ?? result.stdout}`);
  }
  return (result.stdout ?? "").trim();
}

function mktree(repoPath: string, lines: readonly string[]): string {
  const result = spawnSync("git", ["mktree"], {
    cwd: repoPath,
    input: `${lines.join("\n")}\n`,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`git mktree failed: ${result.stderr ?? result.stdout}`);
  }
  return (result.stdout ?? "").trim();
}

function buildTreeSha(repoPath: string, entries: Map<string, string>): string {
  if (entries.size === 0) {
    throw new Error("cannot build empty harness-state tree");
  }
  const dirChildren = new Map<string, Map<string, string>>();
  const rootBlobs: string[] = [];
  for (const [filePath, sha] of entries) {
    const slash = filePath.indexOf("/");
    if (slash < 0) {
      rootBlobs.push(`100644 blob ${sha}\t${filePath}`);
      continue;
    }
    const dir = filePath.slice(0, slash);
    const rest = filePath.slice(slash + 1);
    const bucket = dirChildren.get(dir) ?? new Map<string, string>();
    bucket.set(rest, sha);
    dirChildren.set(dir, bucket);
  }
  const rootLines = [...rootBlobs];
  for (const [dir, children] of [...dirChildren.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const subtree = buildTreeSha(repoPath, children);
    rootLines.push(`040000 tree ${subtree}\t${dir}`);
  }
  return mktree(repoPath, rootLines);
}

function commitViaTreeCache(
  repoPath: string,
  parent: string,
  ops: readonly FastImportFileOp[],
  message: string,
  blobCache: Record<string, string>,
): { readonly commitSha: string; readonly blobCache: Record<string, string> } {
  const entries = new Map<string, string>(Object.entries(blobCache));
  for (const op of ops) {
    if (op.mode === "delete") {
      entries.delete(op.path);
      continue;
    }
    entries.set(op.path, writeBlob(repoPath, op.content ?? ""));
  }
  const treeSha = buildTreeSha(repoPath, entries);
  const commit = spawnSync("git", ["commit-tree", treeSha, "-p", parent, "-m", message], {
    cwd: repoPath,
    encoding: "utf8",
    windowsHide: true,
  });
  if (commit.status !== 0) {
    throw new Error(`git commit-tree failed: ${commit.stderr ?? commit.stdout}`);
  }
  const commitSha = (commit.stdout ?? "").trim();
  const updateRef = spawnSync("git", ["update-ref", HARNESS_STATE_BRANCH, commitSha], {
    cwd: repoPath,
    encoding: "utf8",
    windowsHide: true,
  });
  if (updateRef.status !== 0) {
    throw new Error(`git update-ref failed: ${updateRef.stderr ?? updateRef.stdout}`);
  }
  return { commitSha, blobCache: Object.fromEntries(entries) };
}

function importInitialFastImport(repoPath: string, ops: readonly FastImportFileOp[], message: string): string {
  const lines: string[] = [];
  let nextMark = 1;
  const marks = new Map<string, number>();
  for (const op of ops) {
    if (op.mode === "delete") continue;
    const mark = nextMark;
    nextMark += 1;
    marks.set(op.path, mark);
    lines.push("blob", `mark :${mark}`, `data ${Buffer.byteLength(op.content ?? "", "utf8")}`, op.content ?? "");
  }
  lines.push("commit refs/heads/harness-state");
  lines.push("committer EF Harness <foundation@ef-harness.local> 0 +0000");
  lines.push(`data ${Buffer.byteLength(message, "utf8")}`, message);
  for (const op of ops) {
    if (op.mode === "delete") continue;
    const mark = marks.get(op.path);
    if (!mark) continue;
    lines.push(`M 100644 :${mark} ${op.path}`);
  }
  const script = `${lines.join("\n")}\n`;
  const result = spawnSync("git", ["fast-import", "--quiet", "--force"], {
    cwd: repoPath,
    input: script,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`git fast-import failed: ${result.stderr ?? result.stdout}`);
  }
  const tip = spawnSync("git", ["rev-parse", HARNESS_STATE_BRANCH], {
    cwd: repoPath,
    encoding: "utf8",
    windowsHide: true,
  });
  return (tip.stdout ?? "").trim();
}

export class GitFastImportWriter {
  constructor(
    private readonly repoPath: string,
    private readonly git: MinGitRepoInspectorPort,
  ) {}

  readHarnessStateTip(): string | null {
    return this.git.readRef(this.repoPath, HARNESS_STATE_BRANCH);
  }

  apply(
    ops: readonly FastImportFileOp[],
    message: string,
    blobCache: Record<string, string> = {},
  ): FastImportResult & { readonly blobCache: Record<string, string> } {
    const started = performance.now();
    if (ops.length === 0) {
      return {
        commitSha: this.readHarnessStateTip(),
        noop: true,
        durationMs: performance.now() - started,
        blobCache,
      };
    }

    const parent = this.readHarnessStateTip();
    if (!parent) {
      const nextCache: Record<string, string> = { ...blobCache };
      for (const op of ops) {
        if (op.mode === "delete") continue;
        nextCache[op.path] = writeBlob(this.repoPath, op.content ?? "");
      }
      const commitSha =
        ops.length <= 64
          ? importInitialFastImport(this.repoPath, ops, message)
          : (() => {
              const entries = new Map<string, string>(Object.entries(nextCache));
              const treeSha = buildTreeSha(this.repoPath, entries);
              const commit = spawnSync("git", ["commit-tree", treeSha, "-m", message], {
                cwd: this.repoPath,
                encoding: "utf8",
                windowsHide: true,
              });
              if (commit.status !== 0) {
                throw new Error(`git commit-tree failed: ${commit.stderr ?? commit.stdout}`);
              }
              const sha = (commit.stdout ?? "").trim();
              const updateRef = spawnSync("git", ["update-ref", HARNESS_STATE_BRANCH, sha], {
                cwd: this.repoPath,
                encoding: "utf8",
                windowsHide: true,
              });
              if (updateRef.status !== 0) {
                throw new Error(`git update-ref failed: ${updateRef.stderr ?? updateRef.stdout}`);
              }
              return sha;
            })();
      return {
        commitSha,
        noop: false,
        durationMs: performance.now() - started,
        blobCache: nextCache,
      };
    }

    const incremental = commitViaTreeCache(this.repoPath, parent, ops, message, blobCache);
    return {
      commitSha: incremental.commitSha,
      noop: false,
      durationMs: performance.now() - started,
      blobCache: incremental.blobCache,
    };
  }
}

export function createNodeGitInspector(): MinGitRepoInspectorPort {
  return {
    run(args, cwd, input) {
      const result = spawnSync("git", args, {
        cwd,
        encoding: "utf8",
        input,
        windowsHide: true,
      });
      return { stdout: `${result.stdout ?? ""}${result.stderr ?? ""}`, status: result.status ?? 1 };
    },
    readRef(repoPath, ref) {
      const result = spawnSync("git", ["rev-parse", "--verify", ref], {
        cwd: repoPath,
        encoding: "utf8",
        windowsHide: true,
      });
      if (result.status !== 0) return null;
      return (result.stdout ?? "").trim() || null;
    },
  };
}

export function listTreePaths(repoPath: string, ref: string): readonly string[] {
  const result = spawnSync("git", ["ls-tree", "-r", "--name-only", ref], {
    cwd: repoPath,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) return [];
  return (result.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function readBlobAtPath(repoPath: string, ref: string, filePath: string): string | null {
  const result = spawnSync("git", ["show", `${ref}:${filePath}`], {
    cwd: repoPath,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) return null;
  return result.stdout ?? "";
}