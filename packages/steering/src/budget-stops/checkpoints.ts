import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { assertNotProtectedRef, gitOrThrow, refExists, runGit } from "./git-repo.js";
import { CheckpointDiscardError, type AttemptCheckpoint, type CheckpointWrite, type FilePayload } from "./types.js";

export interface CheckpointStore {
  write(input: CheckpointWrite): AttemptCheckpoint;
  list(): readonly AttemptCheckpoint[];
  discard(ref: string, authorization: { readonly explicit: true }): void;
}

export class InMemoryCheckpointStore implements CheckpointStore {
  private readonly items: AttemptCheckpoint[] = [];
  private next = 1;

  write(input: CheckpointWrite): AttemptCheckpoint {
    const ref = checkpointRef(input.taskId, this.next);
    this.next += 1;
    const record: AttemptCheckpoint = {
      taskId: input.taskId,
      ref,
      sha: `ckpt-${this.items.length + 1}-${input.taskId}`,
      files: input.files.map((file) => ({ path: file.path, contents: file.contents })),
      failingTestOutput: input.failingTestOutput,
      partial: true,
    };
    this.items.push(record);
    return record;
  }

  list(): readonly AttemptCheckpoint[] {
    return this.items.map((item) => ({ ...item, files: item.files.map((file) => ({ ...file })) }));
  }

  discard(ref: string, authorization: { readonly explicit: true }): void {
    assertExplicitDiscard(authorization);
    const index = this.items.findIndex((item) => item.ref === ref);
    if (index < 0) throw new CheckpointDiscardError(`unknown checkpoint ${ref}`);
    this.items.splice(index, 1);
  }
}

export class GitCheckpointStore implements CheckpointStore {
  private readonly records: AttemptCheckpoint[] = [];
  private next = 1;

  constructor(private readonly repoPath: string) {}

  write(input: CheckpointWrite): AttemptCheckpoint {
    const ref = checkpointRef(input.taskId, this.next);
    this.next += 1;
    assertNotProtectedRef(ref);
    const parent = gitOrThrow(this.repoPath, ["rev-parse", "refs/heads/harness/integration"]);
    const sha = commitDetached(this.repoPath, parent, input.files, `checkpoint ${input.taskId}`);
    gitOrThrow(this.repoPath, ["update-ref", ref, sha]);
    const record: AttemptCheckpoint = {
      taskId: input.taskId,
      ref,
      sha,
      files: input.files.map((file) => ({ path: file.path, contents: file.contents })),
      failingTestOutput: input.failingTestOutput,
      partial: true,
    };
    this.records.push(record);
    return record;
  }

  list(): readonly AttemptCheckpoint[] {
    return this.records.map((item) => ({ ...item, files: item.files.map((file) => ({ ...file })) }));
  }

  discard(ref: string, authorization: { readonly explicit: true }): void {
    assertExplicitDiscard(authorization);
    if (!ref.startsWith("refs/harness/checkpoints/")) {
      throw new CheckpointDiscardError("only checkpoint refs can be discarded");
    }
    assertNotProtectedRef(ref);
    if (!refExists(this.repoPath, ref)) {
      throw new CheckpointDiscardError(`unknown checkpoint ${ref}`);
    }
    gitOrThrow(this.repoPath, ["update-ref", "-d", ref]);
    const index = this.records.findIndex((item) => item.ref === ref);
    if (index >= 0) this.records.splice(index, 1);
  }
}

export function checkpointRef(taskId: string, n: number): string {
  return `refs/harness/checkpoints/${taskId}/${n}`;
}

function assertExplicitDiscard(authorization: { readonly explicit: true }): void {
  if (authorization.explicit !== true) {
    throw new CheckpointDiscardError("unmerged checkpoints stay until an explicit discard");
  }
}

function commitDetached(repo: string, parent: string, files: readonly FilePayload[], message: string): string {
  const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-ckpt-"));
  const worktree = path.join(parentDir, "wt");
  try {
    gitOrThrow(repo, ["worktree", "add", "--detach", worktree, parent]);
    for (const file of files) {
      const full = path.join(worktree, file.path);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, file.contents, "utf8");
    }
    if (files.length === 0) {
      fs.writeFileSync(path.join(worktree, ".checkpoint-empty"), "checkpoint\n", "utf8");
    }
    gitOrThrow(worktree, ["add", "--all"]);
    gitOrThrow(worktree, ["-c", "commit.gpgsign=false", "commit", "-m", message]);
    return gitOrThrow(worktree, ["rev-parse", "HEAD"]);
  } finally {
    const removal = runGit(repo, ["worktree", "remove", "--force", worktree]);
    if (removal.status !== 0) {
      runGit(repo, ["worktree", "prune"]);
    }
    fs.rmSync(parentDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}
