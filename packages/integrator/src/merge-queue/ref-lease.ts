import { FEATURE_REF_PREFIX, INTEGRATION_REF, LEASE_TTL_MS, QUEUE_HOLDER } from "./constants.js";
import { MergeQueueError, RefLeaseHeldError } from "./errors.js";
import { revParse, runGit } from "./git.js";
import { sqlNumber, sqlText, type MergeQueueStateDb } from "./state-db.js";
import type { AcquiredLease, CasAdvanceResult } from "./types.js";

/**
 * Local port of Task 039 `RefLeaseManager` for `refs/heads/harness/integration`.
 * The lease row matches `state.db.ref_leases`. Advancement is `git update-ref <new> <old>`.
 */
export class RefLeasePort {
  constructor(
    private readonly db: MergeQueueStateDb,
    private readonly repo: string,
    private readonly now: () => number,
  ) {}

  acquire(): AcquiredLease {
    const sha = revParse(this.repo, INTEGRATION_REF);
    const now = this.now();
    return this.db.transaction(() => {
      const row = this.db.get("SELECT ref, holder, epoch, expected_sha, expires_at FROM ref_leases WHERE ref = ?", [
        INTEGRATION_REF,
      ]);
      if (row) {
        const holder = sqlText(row, "holder");
        const expires = sqlNumber(row, "expires_at");
        if (holder !== QUEUE_HOLDER && expires > now) {
          throw new RefLeaseHeldError(INTEGRATION_REF, holder);
        }
      }
      const epoch = row && sqlText(row, "holder") === QUEUE_HOLDER ? sqlNumber(row, "epoch") : sqlNumber(row, "epoch") + 1;
      const nextEpoch = epoch < 1 ? 1 : epoch;
      this.db.run(
        `INSERT INTO ref_leases (ref, holder, epoch, expected_sha, expires_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(ref) DO UPDATE SET
           holder = excluded.holder,
           epoch = excluded.epoch,
           expected_sha = excluded.expected_sha,
           expires_at = excluded.expires_at`,
        [INTEGRATION_REF, QUEUE_HOLDER, nextEpoch, sha, now + LEASE_TTL_MS],
      );
      return { ref: INTEGRATION_REF, holder: QUEUE_HOLDER, epoch: nextEpoch, expectedSha: sha };
    });
  }

  advance(newSha: string, expectedOldSha: string, epoch: number): CasAdvanceResult {
    const now = this.now();
    this.db.transaction(() => {
      const row = this.db.get("SELECT holder, epoch, expires_at FROM ref_leases WHERE ref = ?", [INTEGRATION_REF]);
      if (!row || sqlText(row, "holder") !== QUEUE_HOLDER || sqlNumber(row, "epoch") !== epoch) {
        throw new RefLeaseHeldError(INTEGRATION_REF, sqlText(row, "holder") || "none");
      }
      if (sqlNumber(row, "expires_at") <= now) {
        throw new RefLeaseHeldError(INTEGRATION_REF, "expired");
      }
    });
    const updated = runGit(this.repo, ["update-ref", INTEGRATION_REF, newSha, expectedOldSha]);
    if (updated.status !== 0) {
      const actualSha = revParse(this.repo, INTEGRATION_REF);
      return { ok: false, reason: "cas_mismatch", actualSha };
    }
    this.db.run("UPDATE ref_leases SET expected_sha = ?, expires_at = ? WHERE ref = ? AND holder = ? AND epoch = ?", [
      newSha,
      now + LEASE_TTL_MS,
      INTEGRATION_REF,
      QUEUE_HOLDER,
      epoch,
    ]);
    return { ok: true, sha: newSha };
  }

  release(epoch: number): void {
    this.db.run("DELETE FROM ref_leases WHERE ref = ? AND holder = ? AND epoch = ?", [
      INTEGRATION_REF,
      QUEUE_HOLDER,
      epoch,
    ]);
  }

  releaseOwn(): void {
    this.db.run("DELETE FROM ref_leases WHERE ref = ? AND holder = ?", [INTEGRATION_REF, QUEUE_HOLDER]);
  }
}

export function assertFeatureRef(ref: string): void {
  if (!ref.startsWith(FEATURE_REF_PREFIX) || ref.length <= FEATURE_REF_PREFIX.length) {
    throw new MergeQueueError("invalid_feature_ref", `${ref} must be refs/heads/harness/f/<feature>`);
  }
}
