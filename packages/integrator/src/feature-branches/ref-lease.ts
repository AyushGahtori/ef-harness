import { CasMismatchError, FeatureBranchError, RefLeaseHeldError, StaleRefLeaseError } from "./errors.js";
import { gitOk, runGit } from "./git.js";
import type { FeatureBranchStateDb } from "./state-db.js";
import { ZERO_OID } from "./types.js";

export interface AcquiredLease {
  readonly ref: string;
  readonly holder: string;
  readonly epoch: number;
  readonly expectedSha: string | null;
}

export interface CasAdvanceResult {
  readonly ok: true;
  readonly sha: string;
}

/**
 * Local port of Task 039 `RefLeaseManager.advanceRefCas` for `harness/f/*` and `harness/integration`.
 * Every branch move in this package goes through `advance` (`git update-ref <ref> <new> <old>`).
 */
export class LocalRefLeaseManager {
  constructor(
    private readonly db: FeatureBranchStateDb,
    private readonly repo: string,
    private readonly now: () => number = () => Date.now(),
    private readonly ttlMs = 60 * 60 * 1000,
  ) {}

  acquire(ref: string, holder: string, expectedSha: string | null): AcquiredLease {
    assertHarnessRef(ref);
    const now = this.now();
    return this.db.transaction(() => {
      const row = this.read(ref);
      if (row && row.expiresAt > now && row.holder !== holder) {
        throw new RefLeaseHeldError(ref);
      }
      const epoch = row ? row.epoch + 1 : 1;
      const expiresAt = now + this.ttlMs;
      if (row) {
        this.db.run(
          `UPDATE ref_leases SET holder = ?, epoch = ?, expected_sha = ?, expires_at = ? WHERE ref = ?`,
          [holder, epoch, expectedSha, expiresAt, ref],
        );
      } else {
        this.db.run(
          `INSERT INTO ref_leases (ref, holder, epoch, expected_sha, expires_at) VALUES (?, ?, ?, ?, ?)`,
          [ref, holder, epoch, expectedSha, expiresAt],
        );
      }
      return { ref, holder, epoch, expectedSha };
    });
  }

  advance(ref: string, holder: string, epoch: number, newSha: string, expectedOld: string): CasAdvanceResult {
    assertHarnessRef(ref);
    const now = this.now();
    this.db.transaction(() => {
      this.requireCurrent(ref, holder, epoch, now);
    });
    const updated = runGit({
      repo: this.repo,
      args: ["update-ref", ref, newSha, expectedOld],
    });
    if (updated.status !== 0) {
      const actual = readRef(this.repo, ref) ?? ZERO_OID;
      throw new CasMismatchError(actual);
    }
    this.db.run(`UPDATE ref_leases SET expected_sha = ?, expires_at = ? WHERE ref = ? AND holder = ? AND epoch = ?`, [
      newSha,
      now + this.ttlMs,
      ref,
      holder,
      epoch,
    ]);
    return { ok: true, sha: newSha };
  }

  /**
   * Recreate a missing ref from the last verified object. The old value is the zero OID,
   * so this cannot clobber a ref that still exists.
   */
  recreate(ref: string, holder: string, epoch: number, sha: string): CasAdvanceResult {
    return this.advance(ref, holder, epoch, sha, ZERO_OID);
  }

  deleteRef(ref: string, holder: string, epoch: number, expectedSha: string): void {
    assertHarnessRef(ref);
    const now = this.now();
    this.requireCurrent(ref, holder, epoch, now);
    const deleted = runGit({ repo: this.repo, args: ["update-ref", "-d", ref, expectedSha] });
    if (deleted.status !== 0) {
      throw new StaleRefLeaseError(deleted.stderr || deleted.stdout || ref);
    }
    this.db.run(`DELETE FROM ref_leases WHERE ref = ? AND holder = ? AND epoch = ?`, [ref, holder, epoch]);
  }

  release(ref: string, holder: string, epoch: number): void {
    const changes = this.db.run(
      `UPDATE ref_leases SET expires_at = 0 WHERE ref = ? AND holder = ? AND epoch = ?`,
      [ref, holder, epoch],
    );
    if (changes !== 1) {
      throw new StaleRefLeaseError(ref);
    }
  }

  private requireCurrent(ref: string, holder: string, epoch: number, now: number): void {
    const row = this.read(ref);
    if (!row || row.holder !== holder || row.epoch !== epoch || row.expiresAt <= now) {
      throw new StaleRefLeaseError(ref);
    }
  }

  private read(ref: string): { holder: string; epoch: number; expiresAt: number; expectedSha: string | null } | null {
    const row = this.db.get(`SELECT holder, epoch, expires_at, expected_sha FROM ref_leases WHERE ref = ?`, [ref]);
    if (!row) return null;
    const holder = row.holder;
    const epoch = row.epoch;
    const expiresAt = row.expires_at;
    const expected = row.expected_sha;
    if (typeof holder !== "string" || typeof epoch !== "number" || typeof expiresAt !== "number") return null;
    return {
      holder,
      epoch,
      expiresAt,
      expectedSha: typeof expected === "string" ? expected : null,
    };
  }
}

function assertHarnessRef(ref: string): void {
  if (!/^refs\/heads\/harness\/(?:integration|f\/[A-Za-z0-9][A-Za-z0-9._-]*)$/.test(ref)) {
    throw new FeatureBranchError("invalid_ref", `Ref ${ref} is outside harness/integration and harness/f/*.`);
  }
}

function readRef(repo: string, ref: string): string | null {
  const result = runGit({ repo, args: ["rev-parse", "--verify", ref] });
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

export function commitTree(repo: string, tree: string, parent: string, message: string): string {
  return gitOk({
    repo,
    args: ["commit-tree", tree, "-p", parent, "-m", message],
  }).stdout.trim();
}

export function writeTree(worktree: string): string {
  return gitOk({ repo: worktree, args: ["write-tree"] }).stdout.trim();
}

export function alignCleanWorktree(worktree: string): void {
  gitOk({ repo: worktree, args: ["reset", "--keep", "HEAD"] });
}
