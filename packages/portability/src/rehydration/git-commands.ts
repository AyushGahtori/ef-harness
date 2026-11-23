import { spawnSync } from "node:child_process";

import type { GitCommandPort } from "./types.js";

export function createNodeGitCommandPort(): GitCommandPort {
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