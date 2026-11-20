export type CasFormat = "zstd" | "zstd-seekable" | "raw";

export type CasHolderKind = "project" | "backup" | "research" | "export" | "pending";

export type CasBlobState = "ok" | "quarantined";

export interface CasHolder {
  readonly holderKind: CasHolderKind;
  readonly holderId: string;
}

/**
 * putBlob persists bytes that are already framed when `storedPayload` is set.
 * The CAS key is always the SHA-256 of `uncompressed`.
 * Task 028's CasBlobStore is expected to honor `format` and, for `zstd-seekable`,
 * store `storedPayload` without wrapping it in a second zstd frame.
 */
export interface CasPutRequest {
  readonly uncompressed: Uint8Array;
  readonly storedPayload: Uint8Array;
  readonly format: CasFormat;
  readonly holder: CasHolder;
  readonly createdAt: number;
}

export interface CasWriteResult {
  readonly hash: string;
  readonly bytes: number;
  readonly storedBytes: number;
  readonly format: CasFormat;
}

export interface CompressedBlob {
  readonly hash: string;
  readonly format: CasFormat;
  readonly storedPayload: Uint8Array;
  readonly bytes: number;
  readonly storedBytes: number;
  readonly state: CasBlobState;
}

export interface CasIntegrityVerdict {
  readonly ok: boolean;
  readonly hash: string;
  readonly reason: string | null;
}

export interface CasVerificationCandidate {
  readonly hash: string;
  readonly lastVerifiedAt: number | null;
  readonly format: CasFormat;
}

/**
 * Subset of Task 028's CasBlobStore plus compressed-range access.
 * Range reads must use `readCompressed` so a 200 MB trace is not inflated up front.
 */
export interface CasBlobStore {
  putBlob(request: CasPutRequest): CasWriteResult;
  readCompressed(hash: string): CompressedBlob;
  verifyBlobIntegrity(hash: string): CasIntegrityVerdict;
  pinBlob(hash: string, holder: CasHolder, pinnedAt: number): void;
  unpinHolder(hash: string, holder: CasHolder): void;
  quarantineBlob(hash: string): void;
  markVerified(hash: string, verifiedAt: number): void;
  totalPinnedStoredBytes(): number;
  listVerificationCandidates(): readonly CasVerificationCandidate[];
}

export class CasIntegrityMismatchError extends Error {
  readonly code = "CAS_INTEGRITY_MISMATCH" as const;
  readonly hash: string;

  constructor(hash: string, message = "CAS blob failed integrity verification") {
    super(message);
    this.name = "CasIntegrityMismatchError";
    this.hash = hash;
  }
}

export class CasBlobMissingError extends Error {
  readonly code = "CAS_BLOB_MISSING" as const;
  readonly hash: string;

  constructor(hash: string) {
    super(`CAS blob ${hash} is missing.`);
    this.name = "CasBlobMissingError";
    this.hash = hash;
  }
}
