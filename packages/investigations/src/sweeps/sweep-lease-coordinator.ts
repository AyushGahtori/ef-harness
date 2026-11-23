import { RepoWideSweepConflictError } from "./errors.js";
import { globToPathPrefix, normalizePrefixes, pathOverlapsLease, scopeToGlobs } from "./path-prefix.js";
import type { SweepLeasePort } from "./ports.js";
import type { SweepGrantRecord, SweepIntentRecord, SweepLeaseAcquireInput, SweepPathScope } from "./types.js";
import { REPO_WIDE_PREFIX } from "./types.js";

export type SweepLeaseCoordinatorOptions = {
  readonly leases: SweepLeasePort;
};

export class SweepLeaseCoordinator {
  private readonly leases: SweepLeasePort;

  constructor(options: SweepLeaseCoordinatorOptions) {
    this.leases = options.leases;
  }

  acquireIntent(input: SweepLeaseAcquireInput): SweepIntentRecord {
    this.assertRepoWideSingleton(input.scope, input.leaseId);
    const globs = scopeToGlobs(input.scope);
    const prefixes = normalizePrefixes(globs);
  if (prefixes.length === 0) {
      throw new Error("sweep intent requires at least one path prefix");
    }
    const sortedGlobs = Object.freeze(
      [...globs].sort((a, b) => globToPathPrefix(a).localeCompare(globToPathPrefix(b))),
    );
    return this.leases.openSweepIntent({
      leaseId: input.leaseId,
      sweepTask: input.sweepTask,
      globs: sortedGlobs,
      now: input.now,
    });
  }

  tryGrant(leaseId: string): SweepGrantRecord {
    return this.leases.grantSweepLease(leaseId);
  }

  release(leaseId: string): { readonly released: boolean } {
    return this.leases.releaseSweepLease(leaseId);
  }

  overlappingIntentBlocksClaim(
    taskPrefixes: readonly string[],
    activeLeases: readonly { readonly leaseId: string; readonly mode: "intent" | "granted"; readonly prefixes: readonly string[] }[],
  ): boolean {
    return activeLeases.some(
      (lease) =>
        (lease.mode === "intent" || lease.mode === "granted") &&
        taskPrefixes.some((prefix) => pathOverlapsLease(prefix, lease.prefixes)),
    );
  }

  canonicalLeaseOrder(leaseIds: readonly string[]): readonly string[] {
    return [...leaseIds].sort((a, b) => a.localeCompare(b));
  }

  private assertRepoWideSingleton(scope: SweepPathScope, leaseId: string): void {
    if (scope.kind !== "repo_wide") return;
    const active = this.leases.listActiveRepoWideLeases?.() ?? [];
    for (const id of active) {
      if (id !== leaseId) {
        throw new RepoWideSweepConflictError(id);
      }
    }
    const prefixes = normalizePrefixes(scopeToGlobs(scope));
    if (prefixes.includes(REPO_WIDE_PREFIX) && active.length > 0 && !active.includes(leaseId)) {
      throw new RepoWideSweepConflictError(active[0] ?? "unknown");
    }
  }
}