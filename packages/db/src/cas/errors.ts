import type { CasDependentReceiptMark, CasRetention } from "./types.js";

export interface CasIntegrityMismatchDetails {
  readonly hash: string;
  readonly actualHash: string;
  readonly retention: CasRetention | null;
  readonly dependentReceipts: readonly CasDependentReceiptMark[];
  readonly reason: string;
  readonly cause?: unknown;
}

/** Thrown instead of returning bytes when stored content does not match its hash. */
export class CasIntegrityMismatchError extends Error {
  readonly code = "CAS_INTEGRITY_MISMATCH" as const;
  readonly hash: string;
  readonly actualHash: string;
  readonly retention: CasRetention | null;
  readonly dependentReceipts: readonly CasDependentReceiptMark[];
  readonly reason: string;

  constructor(details: CasIntegrityMismatchDetails) {
    super(
      `CAS integrity mismatch for ${details.hash}`,
      details.cause === undefined ? undefined : { cause: details.cause },
    );
    this.name = "CasIntegrityMismatchError";
    this.hash = details.hash;
    this.actualHash = details.actualHash;
    this.retention = details.retention;
    this.dependentReceipts = details.dependentReceipts;
    this.reason = details.reason;
  }
}

/** Thrown when a referenced blob is not on disk. Callers report missing evidence and continue. */
export class CasBlobMissingError extends Error {
  readonly code = "CAS_BLOB_MISSING" as const;
  readonly hash: string;

  constructor(hash: string) {
    super(`CAS blob missing: ${hash}`);
    this.name = "CasBlobMissingError";
    this.hash = hash;
  }
}
