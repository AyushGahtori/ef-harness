import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gitOk, revParse, runGit } from "./git.js";
import type { MergeQueueStateDb } from "./state-db.js";
import type { SlotHandle } from "./types.js";

/**
 * Local port of Task 038 `WorktreeSlotPool.acquireMergeWorktree`.
 * Fresh detached worktrees. Never the persistent integration worktree.
 */
export class MergeWorktreePort {
  constructor(
    private readonly db: MergeQueueStateDb,
    private readonly repo: string,
    private readonly now: () => number,
  ) {}

  acquire(baseSha: string): SlotHandle {
    const root = mkdtempSync(path.join(tmpdir(), "ef-mq-"));
    const slotPath = path.join(root, "merge");
    gitOk(this.repo, ["worktree", "add", "--detach", slotPath, baseSha]);
    this.db.run("INSERT INTO merge_queue_worktrees (path, created_at) VALUES (?, ?)", [slotPath, this.now()]);
    return {
      slotPath,
      baseCommit: revParse(slotPath, "HEAD"),
      headMode: "detached",
      kind: "merge",
    };
  }

  remove(slotPath: string): void {
    const removed = runGit(this.repo, ["worktree", "remove", "--force", slotPath]);
    if (removed.status !== 0) {
      runGit(this.repo, ["worktree", "prune"]);
    }
    rmSync(path.dirname(slotPath), { recursive: true, force: true });
    this.db.run("DELETE FROM merge_queue_worktrees WHERE path = ?", [slotPath]);
  }

  recorded(): string[] {
    return this.db
      .all("SELECT path FROM merge_queue_worktrees ORDER BY path", [])
      .map((row) => (typeof row.path === "string" ? row.path : ""))
      .filter((value) => value.length > 0);
  }
}
