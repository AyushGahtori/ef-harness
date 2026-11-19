/** Holder that keeps a blob alive. Pins live in global.db, not in the project file. */
export type CasHolderKind = "project" | "backup" | "research" | "export" | "pending";

/** Retention class recorded on state.db.artifacts. Evidence and asset reads always verify. */
export type CasRetention = "evidence" | "diagnostic" | "ephemeral" | "asset";

/** On-disk codec. The hash is always SHA-256 of the uncompressed bytes. */
export type CasStoredFormat = "zstd" | "zstd-seekable" | "raw";

/** Codecs this store will write. Seekable frames belong to the artifact manager. */
export type CasWriteFormat = "zstd" | "raw";

export interface CasPutPin {
  readonly holderKind: CasHolderKind;
  readonly holderId: string;
  readonly format?: CasWriteFormat;
}

/** Returned only after cas_blobs and cas_pins have been committed. */
export interface CasWriteResult {
  readonly hash: string;
  readonly bytes: number;
  readonly storedBytes: number;
  readonly format: CasStoredFormat;
  readonly absolutePath: string;
  readonly deduplicated: boolean;
  readonly replacedCorrupt: boolean;
  readonly holderKind: CasHolderKind;
  readonly holderId: string;
}

export interface CasIntegrityVerification {
  readonly hash: string;
  readonly bytes: number;
  readonly verifiedAt: number;
}

export interface CasDependentReceiptMark {
  readonly checkId: string;
  readonly attempt: string;
  readonly checkVersion: number;
  readonly artifactDigest: string;
  readonly previousStatus: string;
  readonly previousReceipt: string | null;
}

export interface CasCorruptionEvent {
  readonly kind: "cas.corruption";
  readonly hash: string;
  readonly actualHash: string;
  readonly retention: CasRetention | null;
  readonly reason: string;
  readonly at: number;
  readonly affectedArtifactIds: readonly string[];
  readonly dependentReceipts: readonly CasDependentReceiptMark[];
}

export interface CasScrubRecoveryAlert {
  readonly kind: "cas.scrub_recovery";
  readonly hash: string;
  readonly at: number;
  readonly message: string;
}

export type CasStoreEvent = CasCorruptionEvent | CasScrubRecoveryAlert;

export interface CasGcResult {
  readonly scanned: number;
  readonly deleted: readonly string[];
  readonly skippedPinned: number;
  readonly tempFilesRemoved: number;
}

export interface CasPinSyncResult {
  readonly projectPinsAdded: number;
  readonly projectPinsRemoved: number;
  readonly pendingPinsCleared: number;
}

export interface CasBlobStoreOptions {
  /** Writer connection for global.db (GlobalBrokerDb). Never ATTACH state.db to it. */
  readonly globalDb: import("node:sqlite").DatabaseSync;
  /** Writer connection for state.db (ProjectStateDb). Required for pin sync and receipt marks. */
  readonly projectDb?: import("node:sqlite").DatabaseSync;
  /** Defaults to %LOCALAPPDATA%\\EFHarness\\cas. Tests pass an isolated directory. */
  readonly rootDir?: string;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Replaces the temp-to-final rename. Production uses fs.promises.rename. */
  readonly rename?: (from: string, to: string) => Promise<void>;
  /**
   * Replaces unlink of a promoted blob. The store has already chmod'd the file to 0o666.
   * The hook must delete the file.
   */
  readonly unlinkPromoted?: (filePath: string) => Promise<void>;
  readonly onEvent?: (event: CasStoreEvent) => void;
  /** Override for schema/queries.sql. Defaults to the repository canonical file. */
  readonly queriesSqlPath?: string;
}
