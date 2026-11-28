export const ENV_SCOPES = ["test", "dev", "staging", "prod"] as const;
export type EnvScope = (typeof ENV_SCOPES)[number];

export const VERIFIED_STATUSES = [
  "unverified",
  "verified_test",
  "verified_live",
  "invalid",
  "unreachable",
] as const;
export type VerifiedStatus = (typeof VERIFIED_STATUSES)[number];

export const PROBE_PROVIDERS = [
  "stripe",
  "resend",
  "sendgrid",
  "postgres",
  "openai",
  "anthropic",
  "gemini",
  "openrouter",
] as const;
export type ProbeProvider = (typeof PROBE_PROVIDERS)[number];

export const INJECTION_ROLES = ["preview", "test", "deploy", "coding-worker"] as const;
export type InjectionRole = (typeof INJECTION_ROLES)[number];

export const SANDBOX_TIERS = ["A", "B", "C", "D"] as const;
export type SandboxTier = (typeof SANDBOX_TIERS)[number];

export const DPAPI_REENTRY_MESSAGE =
  "Credentials need to be re-entered on this Windows account" as const;

export const GITIGNORE_OFFER = "Add .env.local to .gitignore first" as const;

export const CREDENTIAL_BLOB_LIMIT = 2560;

export const POSTGRES_PROBE_TIMEOUT_MS = 5_000;

export class VaultError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "VaultError";
    this.code = code;
  }
}

export class LiveKeyRefusedError extends VaultError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "LiveKeyRefusedError";
  }
}

export class CredentialsNeedReentryError extends VaultError {
  constructor(message: string = DPAPI_REENTRY_MESSAGE) {
    super("credentials_need_reentry", message);
    this.name = "CredentialsNeedReentryError";
  }
}

export class ZeroArgvSecretError extends VaultError {
  constructor() {
    super("zero_argv_secret", "Refused to pass a secret on the command line.");
    this.name = "ZeroArgvSecretError";
  }
}

export class SecretNotFoundError extends VaultError {
  constructor(secretId: string) {
    super("secret_not_found", `No vault secret is stored for ${secretId}.`);
    this.name = "SecretNotFoundError";
  }
}

export class SecretNameConflictError extends VaultError {
  constructor(name: string) {
    super(
      "secret_name_conflict",
      `A secret named ${name} already exists in this project and environment scope. Rotate it instead of inserting a second copy.`,
    );
    this.name = "SecretNameConflictError";
  }
}

export class SecretPurgeUnavailableError extends VaultError {
  constructor() {
    super(
      "secret_purge_unavailable",
      "The secret purge engine is not wired. Connect Task 030 SecretPurgeEngine before invoking a purge.",
    );
    this.name = "SecretPurgeUnavailableError";
  }
}

export class WorkerSandboxSecretError extends VaultError {
  constructor() {
    super(
      "worker_sandbox_secret",
      "Coding worker sandboxes cannot receive provider credentials.",
    );
    this.name = "WorkerSandboxSecretError";
  }
}

export interface SecretMetadata {
  readonly secretId: string;
  readonly projectId: string;
  readonly envScope: EnvScope;
  readonly name: string;
  readonly lastFourMasked: string;
  readonly providerHint?: string;
  readonly createdAt: number;
  readonly rotatedAt?: number;
  readonly verifiedStatus: VerifiedStatus;
  readonly credentialTarget: string;
  readonly fingerprint: string;
  readonly taggedProd: boolean;
  readonly testOverride: boolean;
}

export interface SecretNameHash {
  readonly name: string;
  readonly hmac: string;
}

export interface NameOnlySecretDiff {
  readonly added: readonly string[];
  readonly changed: readonly string[];
  readonly deleted: readonly string[];
  readonly summary: string;
}
