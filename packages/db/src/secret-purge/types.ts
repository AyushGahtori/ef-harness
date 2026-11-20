import type { DatabaseSync } from "node:sqlite";

/** Symbolic provider name to the official key-rotation URL. */
export type ProviderRotationLinkMap = Readonly<Record<string, string>>;

export type PurgeStep =
  | "locate"
  | "rewrite"
  | "fts"
  | "vacuum"
  | "cas"
  | "backups"
  | "remote_gate"
  | "rotation";

export type SecretVariantKind = "raw" | "base64" | "base64url" | "url";

export interface SecretVariant {
  readonly kind: SecretVariantKind;
  readonly value: string;
}

export interface SecretOccurrence {
  readonly location: "state" | "cas" | "backup" | "telemetry" | "log";
  readonly table: string;
  readonly ref: string;
  readonly variant: SecretVariantKind;
}

export interface SecretLocationReport {
  readonly occurrences: readonly SecretOccurrence[];
  readonly counts: Readonly<Record<string, number>>;
  /** True when a state.db text column that can travel in harness-state held the secret. */
  readonly reachedExportableState: boolean;
}

/**
 * Audit receipt returned by {@link SecretPurgeEngine.executeSecretPurge}.
 * `secretFingerprint` is an HMAC. The plaintext secret is never stored here.
 */
export interface PurgeReceipt {
  readonly id: string;
  readonly status: "complete" | "partial";
  readonly partial: boolean;
  readonly label: string;
  readonly placeholder: string;
  readonly secretFingerprint: string;
  readonly counts: Readonly<Record<string, number>>;
  readonly hashMapArtifact: string | null;
  readonly rotationMandatory: true;
  readonly rotationUrl: string | null;
  readonly rotationGuidance: string;
  readonly remoteHistoryRewriteRequired: boolean;
  readonly remoteHistoryRewriteMessage: string;
  readonly completedSteps: readonly PurgeStep[];
  readonly failedStep: PurgeStep | null;
  readonly pendingTargets: readonly string[];
  readonly failureMessage: string | null;
}

export interface NodeContentIdentity {
  readonly kind: string;
  readonly title: string;
  readonly text: string;
  readonly fields: unknown;
}

/** Task 007 contract. Injected so this package does not deep-import shared-contracts. */
export type ComputeNodeContentHash = (node: NodeContentIdentity) => string;

/** Task 011 contract. Fingerprint only; callers pass the local machine key. */
export type ComputeSecretHmac = (secret: string, localKey: Buffer | string) => string;

/** Task 018 contract. The engine also runs the canonical optimize statements itself. */
export interface KnowledgeSearchService {
  optimizeSearchIndexes(): void;
  rebuildSearchIndexes?(): void;
}

export type CasHolderKind = "project" | "backup" | "research" | "export" | "pending";

export interface CasPutOptions {
  readonly holderKind: CasHolderKind;
  readonly holderId: string;
  readonly mime?: string;
}

export interface CasWriteResult {
  readonly hash: string;
  readonly bytes: number;
}

/**
 * Task 028 contract used by secret purge.
 * `forceDeletePurgedBlob` bypasses the 7-day unpinned grace window.
 */
export interface CasBlobStore {
  putBlob(bytes: Uint8Array, options: CasPutOptions): CasWriteResult;
  getBlob(hash: string): Uint8Array;
  pinBlob(hash: string, holderKind: CasHolderKind, holderId: string): void;
  unpinHolder(hash: string, holderKind: CasHolderKind, holderId: string): void;
  forceDeletePurgedBlob(hash: string): void;
  listStoredHashes?(): readonly string[];
}

export interface ProjectReaderGate {
  /** Close worker-thread readers. Return false when they cannot be drained. */
  drainReaders(timeoutMs: number): boolean;
}

export interface StructuredLogEvent {
  readonly level: "info" | "warn" | "error";
  readonly component: "secret-purge";
  readonly msg: string;
  readonly fields?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface StructuredLogSink {
  write(event: StructuredLogEvent): void;
}

export interface SecretPurgeHooks {
  /** Throw to abort backup scrub before that file is replaced. Used for idempotent retry. */
  readonly beforeBackupScrub?: (backupPath: string) => void;
}

export interface ExecuteSecretPurgeOptions {
  readonly label?: string;
  readonly forceShortSecret?: boolean;
  /** True when the harness-state branch is known to have been pushed. */
  readonly remotePushed?: boolean;
}

export interface SecretPurgeEngineOptions {
  readonly stateDb: DatabaseSync;
  readonly stateDbPath: string;
  readonly projectId: string;
  readonly hmacKey: Buffer | string;
  readonly computeNodeContentHash?: ComputeNodeContentHash;
  readonly computeSecretHmac?: ComputeSecretHmac;
  readonly search?: KnowledgeSearchService;
  readonly cas?: CasBlobStore;
  readonly casRoot?: string;
  readonly globalDb?: DatabaseSync;
  readonly backupsDir?: string;
  readonly telemetryDbPath?: string;
  readonly logsDir?: string;
  readonly readers?: ProjectReaderGate;
  readonly logSink?: StructuredLogSink;
  readonly readerDrainTimeoutMs?: number;
  readonly now?: () => number;
  readonly hooks?: SecretPurgeHooks;
}

export class PurgeLockUnavailableError extends Error {
  readonly code = "PURGE_LOCK_UNAVAILABLE" as const;

  constructor(
    message = "Project readers could not be drained. Refusing to checkpoint or VACUUM while a secret could remain in the WAL.",
  ) {
    super(message);
    this.name = "PurgeLockUnavailableError";
  }
}

export class SecretTooShortError extends Error {
  readonly code = "SECRET_TOO_SHORT" as const;

  constructor() {
    super(
      "Refusing to purge a string shorter than 8 characters without explicit developer confirmation.",
    );
    this.name = "SecretTooShortError";
  }
}
