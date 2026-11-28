import type { GitStatusLine, GitWorktreeInspectorPort } from "./ports.js";

export interface DirtyTreeCheckResult {
  readonly clean: boolean;
  readonly untrackedPaths: readonly string[];
  readonly modifiedPaths: readonly string[];
}

/**
 * Detects leaky legacy tests that leave the isolated baseline worktree dirty.
 */
export async function checkWorktreeClean(
  inspector: GitWorktreeInspectorPort,
  worktreeRoot: string,
): Promise<DirtyTreeCheckResult> {
  const lines = await inspector.statusPorcelain(worktreeRoot);
  const untrackedPaths: string[] = [];
  const modifiedPaths: string[] = [];
  for (const line of lines) {
    const { path, indexStatus, workTreeStatus } = line;
    const hasUntracked = indexStatus === "?" || workTreeStatus === "?";
    const hasModification = indexStatus !== " " && indexStatus !== "?" || workTreeStatus !== " " && workTreeStatus !== "?";
    if (hasUntracked) {
      untrackedPaths.push(path);
    } else if (hasModification) {
      modifiedPaths.push(path);
    }
  }
  return {
    clean: untrackedPaths.length === 0 && modifiedPaths.length === 0,
    untrackedPaths,
    modifiedPaths,
  };
}

export function parseGitPorcelainLine(line: string): GitStatusLine | null {
  if (line.length < 4) return null;
  const indexStatus = line[0] ?? " ";
  const workTreeStatus = line[1] ?? " ";
  const path = line.slice(3).trim();
  if (!path) return null;
  return { path, indexStatus, workTreeStatus };
}