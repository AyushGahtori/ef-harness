import { INTEGRATION_REF, LEASE_TTL_MS, UNDO_HOLDER } from "./constants.js";
import { RefLeaseHeldError } from "./errors.js";
import { assertForwardCommit, type GitRepo } from "./git.js";
import { sqlNumber, sqlText, type KnowledgeGraphPort } from "./state-db.js";

export interface AcquiredLease {
  readonly ref: string;
  readonly holder: string;
  readonly epoch: number;
  readonly expectedSha: string;
}

export interface CasAdvanceResult {
  readonly ok: boolean;
  readonly sha: string;
  readonly reason: string;
}

/**
 * Local port of Task 039 `RefLeaseAndCasManager`.
 * The lease row matches `state.db.ref_leases`. The branch moves only by
 * `git update-ref <new> <old>` after the undo commit's parent is the old tip.
 */
export class RefLeasePort {
  constructor(
    private readonly graph: KnowledgeGraphPort,
    private readonly git: GitRepo,
    private readonly now: () => number,
  ) {}

  acquire(expectedSha: string): AcquiredLease {
    const now = this.now();
    return this.graph.transaction(() => {
      const row = this.graph.get("SELECT ref, holder, epoch, expected_sha, expires_at FROM ref_leases WHERE ref = ?", [
        INTEGRATION_REF,
      ]);
      if (row) {
        const holder = sqlText(row, "holder");
        const expires = sqlNumber(row, "expires_at");
        if (holder !== UNDO_HOLDER && expires > now) throw new RefLeaseHeldError(INTEGRATION_REF, holder);
      }
      const previous = row && sqlText(row, "holder") === UNDO_HOLDER ? sqlNumber(row, "epoch") : sqlNumber(row, "epoch") + 1;
      const epoch = previous < 1 ? 1 : previous;
      this.graph.run(
        `INSERT INTO ref_leases (ref, holder, epoch, expected_sha, expires_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(ref) DO UPDATE SET
           holder = excluded.holder,
           epoch = excluded.epoch,
           expected_sha = excluded.expected_sha,
           expires_at = excluded.expires_at`,
        [INTEGRATION_REF, UNDO_HOLDER, epoch, expectedSha, now + LEASE_TTL_MS],
      );
      return { ref: INTEGRATION_REF, holder: UNDO_HOLDER, epoch, expectedSha };
    });
  }

  advance(newSha: string, expectedOldSha: string, epoch: number): CasAdvanceResult {
    const now = this.now();
    this.graph.transaction(() => {
      const row = this.graph.get("SELECT holder, epoch, expires_at FROM ref_leases WHERE ref = ?", [INTEGRATION_REF]);
      if (!row || sqlText(row, "holder") !== UNDO_HOLDER || sqlNumber(row, "epoch") !== epoch) {
        throw new RefLeaseHeldError(INTEGRATION_REF, sqlText(row, "holder") || "none");
      }
      if (sqlNumber(row, "expires_at") <= now) throw new RefLeaseHeldError(INTEGRATION_REF, "expired");
    });
    assertForwardCommit(this.git, newSha, expectedOldSha);
    const updated = this.git.run(["update-ref", INTEGRATION_REF, newSha, expectedOldSha]);
    if (updated.status !== 0) {
      return { ok: false, sha: this.git.integrationSha(), reason: "cas_mismatch" };
    }
    this.graph.run("UPDATE ref_leases SET expected_sha = ?, expires_at = ? WHERE ref = ? AND holder = ? AND epoch = ?", [
      newSha,
      now + LEASE_TTL_MS,
      INTEGRATION_REF,
      UNDO_HOLDER,
      epoch,
    ]);
    return { ok: true, sha: newSha, reason: "" };
  }

  release(epoch: number): void {
    this.graph.run("DELETE FROM ref_leases WHERE ref = ? AND holder = ? AND epoch = ?", [INTEGRATION_REF, UNDO_HOLDER, epoch]);
  }
}
