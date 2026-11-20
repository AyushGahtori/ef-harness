import { MERGE_TREE_COMMAND } from "./constants.js";
import { GitCommandError } from "./errors.js";
import { runGit } from "./git.js";
import { parseConflictHunks, reconstructSide } from "./conflict-text.js";
import { tryReadPath } from "./trees.js";
import type { PreflightConflict, PreflightReport } from "./types.js";

interface ParsedMergeTree {
  readonly treeOid: string;
  readonly paths: readonly string[];
  readonly messages: readonly string[];
}

export function parseMergeTreeOutput(stdout: string): ParsedMergeTree {
  let treeOid = "";
  const paths: string[] = [];
  const messages: string[] = [];
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (!treeOid && /^[0-9a-f]{40}$/.test(line.trim())) {
      treeOid = line.trim();
      continue;
    }
    if (line.startsWith("Auto-merging ") || line.startsWith("CONFLICT ")) {
      messages.push(line.trim());
      const named = /^CONFLICT \([^)]+\): Merge conflict in (.+)$/.exec(line.trim());
      if (named?.[1]) paths.push(named[1]);
      continue;
    }
    if (/^\d{6} [0-9a-f]{40} [123]\t/.test(line)) continue;
    if (!line.includes("\t")) paths.push(line.trim());
  }
  const unique: string[] = [];
  for (const path of paths) {
    if (!unique.includes(path)) unique.push(path);
  }
  return { treeOid, paths: unique, messages };
}

/**
 * Zero-checkout preflight. Runs `git merge-tree --write-tree --name-only --messages`
 * and reads conflict hunks from the result tree in the object database.
 */
export class MergeTreePreflightScanner {
  scan(input: { readonly repo: string; readonly ours: string; readonly theirs: string }): PreflightReport {
    const gitResult = runGit({
      repo: input.repo,
      args: ["merge-tree", "--write-tree", "--name-only", "--messages", input.ours, input.theirs],
    });
    if (gitResult.status !== 0 && gitResult.status !== 1) {
      throw new GitCommandError("merge-tree", gitResult.status, gitResult.stderr || gitResult.stdout);
    }
    const parsed = parseMergeTreeOutput(gitResult.stdout);
    if (!parsed.treeOid) {
      throw new GitCommandError("merge-tree", gitResult.status, "missing result tree oid");
    }
    const conflicts: PreflightConflict[] = [];
    for (const path of parsed.paths) {
      const conflicted = tryReadPath(input.repo, parsed.treeOid, path) ?? "";
      const hunks = parseConflictHunks(path, conflicted);
      conflicts.push({
        path,
        hunks,
        oursText: reconstructSide(conflicted, "ours"),
        theirsText: reconstructSide(conflicted, "theirs"),
      });
    }
    return {
      clean: gitResult.status === 0 && conflicts.length === 0,
      treeOid: parsed.treeOid,
      conflicts,
      messages: parsed.messages,
      durationMs: gitResult.durationMs,
      command: MERGE_TREE_COMMAND,
    };
  }
}
