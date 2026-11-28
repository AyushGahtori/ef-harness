import { GitCommandError } from "./errors.js";
import { runGit } from "./git.js";

export interface MergeTreeScan {
  readonly clean: boolean;
  readonly treeOid: string;
  readonly paths: readonly string[];
  readonly command: "git merge-tree --write-tree --name-only --messages";
}

/**
 * Local port of Task 096 `MergeTreePreflightScanner`.
 * Zero-checkout: `git merge-tree --write-tree` reads the object database and does not touch a worktree.
 */
export class LocalMergeTreeScanner {
  scan(input: { readonly repo: string; readonly ours: string; readonly theirs: string }): MergeTreeScan {
    const gitResult = runGit({
      repo: input.repo,
      args: ["merge-tree", "--write-tree", "--name-only", "--messages", input.ours, input.theirs],
    });
    if (gitResult.status !== 0 && gitResult.status !== 1) {
      throw new GitCommandError("merge-tree", gitResult.status, gitResult.stderr || gitResult.stdout);
    }
    let treeOid = "";
    const paths: string[] = [];
    for (const raw of gitResult.stdout.split(/\r?\n/)) {
      const line = raw.trimEnd();
      if (!line.trim()) continue;
      if (!treeOid && /^[0-9a-f]{40}$/.test(line.trim())) {
        treeOid = line.trim();
        continue;
      }
      if (line.startsWith("Auto-merging ") || line.startsWith("CONFLICT ")) {
        const named = /^CONFLICT \([^)]+\): Merge conflict in (.+)$/.exec(line.trim());
        if (named?.[1]) paths.push(named[1]);
        continue;
      }
      if (/^\d{6} [0-9a-f]{40} [123]\t/.test(line)) continue;
      if (!line.includes("\t")) paths.push(line.trim());
    }
    if (!treeOid) {
      throw new GitCommandError("merge-tree", gitResult.status, "missing result tree oid");
    }
    const unique: string[] = [];
    for (const item of paths) {
      if (!unique.includes(item)) unique.push(item);
    }
    return {
      clean: gitResult.status === 0 && unique.length === 0,
      treeOid,
      paths: unique,
      command: "git merge-tree --write-tree --name-only --messages",
    };
  }
}
