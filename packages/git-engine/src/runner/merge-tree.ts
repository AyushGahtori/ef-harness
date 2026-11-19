import { execGit } from "./exec-git.js";
import type { MergeTreePrediction, PredictMergeTreeOptions } from "./types.js";

export function parseMergeTreeOutput(stdout: string): { treeOid: string | null; conflictingPaths: string[] } {
  const lines = stdout.split(/\r?\n/);
  const first = (lines[0] ?? "").trim();
  const treeOid = /^[0-9a-f]{40,64}$/i.test(first) ? first : null;
  const paths = new Set<string>();
  let header = true;
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim() === "") {
      header = false;
      continue;
    }
    if (header) {
      const stage = /^\d{6}\s+[0-9a-f]+\s+[123]\t(.+)$/.exec(line);
      const stagedPath = stage?.[1];
      if (stagedPath) {
        paths.add(stagedPath.replaceAll("\\", "/"));
        continue;
      }
      if (!line.startsWith("Auto-merging ") && !line.startsWith("CONFLICT ")) {
        paths.add(line.trim().replaceAll("\\", "/"));
      }
      continue;
    }
    const conflict = /CONFLICT \([^)]+\): Merge conflict in (.+)$/.exec(line.trim());
    const conflictPath = conflict?.[1];
    if (conflictPath) paths.add(conflictPath.trim().replaceAll("\\", "/"));
  }
  return {
    treeOid,
    conflictingPaths: [...paths].sort((left, right) => left.localeCompare(right)),
  };
}

/**
 * Predict a merge with `git merge-tree --write-tree` entirely in the object store.
 * This does not touch the working tree or the index.
 */
export async function predictMergeTree(options: PredictMergeTreeOptions): Promise<MergeTreePrediction> {
  const result = await execGit({
    args: ["merge-tree", "--write-tree", "--name-only", options.ours, options.theirs],
    cwd: options.cwd,
    developerCheckout: options.developerCheckout ?? true,
    ...(options.gitBinary !== undefined ? { gitBinary: options.gitBinary } : {}),
    ...(options.resourcesRoot !== undefined ? { resourcesRoot: options.resourcesRoot } : {}),
    ...(options.settingsGitPath !== undefined ? { settingsGitPath: options.settingsGitPath } : {}),
    ...(options.env !== undefined ? { env: options.env } : {}),
    ...(options.logger !== undefined ? { logger: options.logger } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  });
  const parsed = parseMergeTreeOutput(result.stdout);
  return {
    clean: result.exitCode === 0 && parsed.conflictingPaths.length === 0,
    treeOid: parsed.treeOid,
    conflictingPaths: parsed.conflictingPaths,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    durationMs: result.durationMs,
  };
}
