import type { SweepLeasePort } from "./ports.js";
import type { StaleSweepLease, StaleSweepRecoveryResult } from "./types.js";
import { SWEEP_BRANCH_PREFIX } from "./types.js";

export type StaleLeaseReader = {
  readonly listOrphanedSweepLeases: () => readonly StaleSweepLease[];
};

export type StaleSweepLeaseRecoveryOptions = {
  readonly reader: StaleLeaseReader;
  readonly leases: SweepLeasePort;
  readonly discardBranch?: (slug: string) => Promise<void> | void;
};

export class StaleSweepLeaseRecovery {
  private readonly reader: StaleLeaseReader;
  private readonly leases: SweepLeasePort;
  private readonly discardBranch: ((slug: string) => Promise<void> | void) | undefined;

  constructor(options: StaleSweepLeaseRecoveryOptions) {
    this.reader = options.reader;
    this.leases = options.leases;
    this.discardBranch = options.discardBranch;
  }

  detectOnColdOpen(): StaleSweepRecoveryResult {
    const leases = this.reader.listOrphanedSweepLeases();
    const prompt =
      leases.length === 0
        ? "No orphaned sweep leases detected."
        : `Resume or Discard Sweep (${leases.length} orphaned lease${leases.length === 1 ? "" : "s"})`;
    return { leases, prompt };
  }

  async applyChoice(leaseId: string, choice: "resume" | "discard", slug?: string): Promise<void> {
    if (choice === "discard") {
      this.leases.releaseSweepLease(leaseId);
      if (slug) {
        await this.discardBranch?.(slug);
      }
      return;
    }
    // Resume keeps the lease and branch parked for orchestrator continuation.
  }

  sweepBranchForSlug(slug: string): string {
    return `${SWEEP_BRANCH_PREFIX}${slug}`;
  }
}