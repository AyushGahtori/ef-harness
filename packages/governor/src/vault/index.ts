export { scanPathsForPlaintext } from "./disk-scan.js";
export type { PlaintextHit } from "./disk-scan.js";
export { WindowsDpapiMaterialStore } from "./dpapi-store.js";
export { GitignoredLocalEnvWriter, formatEnv } from "./env-writer.js";
export type { LocalEnvWriteRequest, LocalEnvWriteResult } from "./env-writer.js";
export { VaultHmac } from "./hmac.js";
export { RuntimeOnlyEnvInjector, isSensitiveEnvName, workerEnvironmentIsCredentialFree } from "./injector.js";
export type { InjectedProcessRequest, InjectedProcessResult } from "./injector.js";
export { SqliteVaultMetadataStore } from "./metadata-store.js";
export { diffSecretNames } from "./name-diff.js";
export { currentWindowsIdentity, lockDownOwnerOnly, parseIcaclsIdentities } from "./ntfs-acl.js";
export {
  awsAccessKeyPrefix,
  containsProdMarker,
  githubPersonalTokenPrefix,
  isDatabaseUrl,
  isTestLikeScope,
  isUnconditionalLiveSecret,
  looksLikeProviderCredential,
  maskLastFour,
  sendGridProductionPrefix,
  stripeLivePrefix,
  stripeLiveRefusalMessage,
  stripePublishableLivePrefix,
  stripeRestrictedLivePrefix,
  stripeTestPrefix,
} from "./patterns.js";
export type {
  ExecuteSecretPurgeOptions,
  GlobalDbRepo,
  ProbeInput,
  ProviderProbeResult,
  ProviderSecretProberPort,
  PurgeOffer,
  PurgeReceipt,
  SecretMaterialStore,
  SecretPurgeEngine,
  StoredSecret,
  VaultSecretSource,
} from "./ports.js";
export {
  PostgresAuthError,
  PostgresUnreachableError,
  postgresMd5Password,
  probePostgresSelectOne,
  scramClientProof,
} from "./postgres-probe.js";
export { ProviderSecretProber } from "./prober.js";
export type { PostgresChecker, ProviderSecretProberOptions } from "./prober.js";
export {
  MIN_REGISTERED_SECRET_LENGTH,
  PacketSecurityRedactor,
  StreamingRedactor,
  normalizeRedactionLabel,
  redactionPlaceholder,
} from "./redactor.js";
export { LiveKeyTestRefusalGuard } from "./refusal.js";
export type { GuardDecision, GuardInput } from "./refusal.js";
export {
  CREDENTIAL_BLOB_LIMIT,
  CredentialsNeedReentryError,
  DPAPI_REENTRY_MESSAGE,
  ENV_SCOPES,
  GITIGNORE_OFFER,
  INJECTION_ROLES,
  LiveKeyRefusedError,
  POSTGRES_PROBE_TIMEOUT_MS,
  PROBE_PROVIDERS,
  SANDBOX_TIERS,
  SecretNameConflictError,
  SecretNotFoundError,
  SecretPurgeUnavailableError,
  VERIFIED_STATUSES,
  VaultError,
  WorkerSandboxSecretError,
  ZeroArgvSecretError,
} from "./types.js";
export type {
  EnvScope,
  InjectionRole,
  NameOnlySecretDiff,
  ProbeProvider,
  SandboxTier,
  SecretMetadata,
  SecretNameHash,
  VerifiedStatus,
} from "./types.js";
export { WindowsDpapiSecretsVault, createSecretId, credentialTargetFor } from "./vault.js";
export type { PutSecretInput, WindowsDpapiSecretsVaultOptions } from "./vault.js";
