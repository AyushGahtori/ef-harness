export class SweepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SweepError";
  }
}

export class RepoWideSweepConflictError extends SweepError {
  constructor(activeLeaseId: string) {
    super(`only one repo-wide sweep may hold a lease at a time (active: ${activeLeaseId})`);
    this.name = "RepoWideSweepConflictError";
  }
}

export class SweepLeaseOrderingError extends SweepError {
  constructor(blockedBy: string) {
    super(`sweep lease blocked by earlier overlapping lease ${blockedBy}`);
    this.name = "SweepLeaseOrderingError";
  }
}