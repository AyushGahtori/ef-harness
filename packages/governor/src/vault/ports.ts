import type { EnvScope, ProbeProvider, SecretMetadata, VerifiedStatus } from "./types.js";

/**
 * Local port of Task 030 `SecretPurgeEngine`.
 * `executeSecretPurge` is the one-click 8-step purge. The plaintext is an argument, never a stored field.
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
  readonly completedSteps: readonly string[];
  readonly failedStep: string | null;
  readonly pendingTargets: readonly string[];
  readonly failureMessage: string | null;
}

export interface ExecuteSecretPurgeOptions {
  readonly label?: string;
  readonly forceShortSecret?: boolean;
  readonly remotePushed?: boolean;
}

export interface SecretPurgeEngine {
  executeSecretPurge(
    secret: string,
    options?: ExecuteSecretPurgeOptions,
  ): PurgeReceipt | Promise<PurgeReceipt>;
}

export interface PurgeOffer {
  readonly secretId: string | null;
  readonly label: string;
  readonly invocation: "one-click";
  invoke(): Promise<PurgeReceipt>;
}

/**
 * Local port of Task 014 metadata writes.
 * Rows are non-secret. `credentialTarget` is a Credential Manager name, never the secret.
 */
export interface GlobalDbRepo {
  upsertVaultMetadata(row: SecretMetadata): void;
  getVaultMetadata(secretId: string): SecretMetadata | null;
  deleteVaultMetadata(secretId: string): void;
  findVaultMetadataByName(projectId: string, envScope: EnvScope, name: string): SecretMetadata | null;
  listVaultMetadata(query?: {
    readonly projectId?: string;
    readonly envScope?: EnvScope;
  }): readonly SecretMetadata[];
}

export interface ProbeInput {
  readonly provider: ProbeProvider;
  readonly secret: string;
  readonly envScope: EnvScope;
  readonly name?: string;
}

export interface ProviderProbeResult {
  readonly status: Exclude<VerifiedStatus, "unverified">;
  readonly stripeLivemode?: boolean;
}

export interface ProviderSecretProberPort {
  probe(input: ProbeInput): Promise<ProviderProbeResult>;
}

export interface StoredSecret {
  readonly secretId: string;
  readonly projectId: string;
  readonly name: string;
  readonly value: string;
  readonly envScope: EnvScope;
  readonly providerHint?: string;
  readonly taggedProd: boolean;
  readonly testOverride: boolean;
}

export interface VaultSecretSource {
  readSecret(secretId: string): Promise<StoredSecret | null>;
}

export interface SecretMaterialStore {
  protectAndWrite(target: string, plaintext: Buffer, overflowPath: string): Promise<void>;
  readAndUnprotect(target: string): Promise<Buffer | null>;
  deleteMaterial(target: string, overflowPath: string): Promise<void>;
  replaceStoredCiphertext(target: string, ciphertext: Buffer, overflowPath: string): Promise<void>;
  close(): Promise<void>;
}
