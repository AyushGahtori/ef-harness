import fs from "node:fs";
import path from "node:path";
import { GitCommandError } from "./errors.js";
import { gitOk, runGit } from "./git.js";
import type { FeatureBranchStore } from "./state-db.js";

export interface SlotHandle {
  readonly slotId: string;
  readonly path: string;
  readonly ref: string;
  readonly role: "feature" | "detached";
  readonly featureId: string | null;
}

/**
 * Local port of Task 038 `WorktreeSlotPool`. Feature branches get one checked-out slot.
 * Sync and lockfile applies use detached slots so a running feature worktree is not the merge target.
 */
export class LocalWorktreeSlotPool {
  private readonly owned = new Set<string>();

  constructor(
    private readonly repo: string,
    private readonly root: string,
    private readonly store: FeatureBranchStore,
  ) {
    fs.mkdirSync(this.root, { recursive: true });
  }

  acquireFeature(input: { readonly slotId: string; readonly featureId: string; readonly branch: string }): SlotHandle {
    const dest = path.join(this.root, input.slotId);
    fs.rmSync(dest, { recursive: true, force: true });
    const added = runGit({
      repo: this.repo,
      args: ["worktree", "add", dest, input.branch],
    });
    if (added.status !== 0) {
      throw new GitCommandError("worktree add", added.status, added.stderr || added.stdout);
    }
    const handle: SlotHandle = {
      slotId: input.slotId,
      path: dest,
      ref: `refs/heads/${input.branch}`,
      role: "feature",
      featureId: input.featureId,
    };
    this.owned.add(handle.slotId);
    this.store.upsertSlot(handle);
    return handle;
  }

  acquireDetached(input: { readonly slotId: string; readonly sha: string; readonly featureId: string | null }): SlotHandle {
    const dest = path.join(this.root, input.slotId);
    fs.rmSync(dest, { recursive: true, force: true });
    gitOk({ repo: this.repo, args: ["worktree", "add", "--detach", dest, input.sha] });
    const handle: SlotHandle = {
      slotId: input.slotId,
      path: dest,
      ref: input.sha,
      role: "detached",
      featureId: input.featureId,
    };
    this.owned.add(handle.slotId);
    this.store.upsertSlot(handle);
    return handle;
  }

  release(slotId: string): void {
    const slot = this.store.slots().find((item) => item.slotId === slotId);
    if (!slot) return;
    const removed = runGit({ repo: this.repo, args: ["worktree", "remove", "--force", slot.path] });
    if (removed.status !== 0 && fs.existsSync(slot.path)) {
      throw new GitCommandError("worktree remove", removed.status, removed.stderr || removed.stdout);
    }
    this.store.removeSlot(slotId);
    this.owned.delete(slotId);
    fs.rmSync(slot.path, { recursive: true, force: true });
  }

  pointingAtRef(ref: string): SlotHandle[] {
    return this.handles().filter((slot) => slot.ref === ref || slot.ref === ref.replace(/^refs\/heads\//, ""));
  }

  forFeature(featureId: string): SlotHandle[] {
    return this.handles().filter((slot) => slot.featureId === featureId);
  }

  handles(): SlotHandle[] {
    return this.store.slots().map((slot) => ({
      slotId: slot.slotId,
      path: slot.path,
      ref: slot.ref,
      role: slot.role === "feature" ? "feature" : "detached",
      featureId: slot.featureId,
    }));
  }

  close(): void {
    for (const slotId of [...this.owned]) this.release(slotId);
    runGit({ repo: this.repo, args: ["worktree", "prune"] });
  }
}
