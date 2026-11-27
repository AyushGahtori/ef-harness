export { computeNodeContentHash, computeSecretHmac, canonicalizeJson, normalizeNfc } from "./canonical.js";
export { RawFileCasBlobStore } from "./cas-store.js";
export { SecretPurgeEngine, createGuardedLogSink } from "./engine.js";
export { bindSecretPurgeEngine } from "./project-bind.js";
export { PROVIDER_ROTATION_URLS, detectSecretLabel, ROTATION_GUIDANCE } from "./provider-rotation.js";
export { createSqliteKnowledgeSearchMaintenance } from "./search-maintenance.js";

export type {
  CasBlobStore,
  CasPutOptions,
  CasWriteResult,
  ComputeNodeContentHash,
  ComputeSecretHmac,
  ExecuteSecretPurgeOptions,
  KnowledgeSearchService,
  NodeContentIdentity,
  ProjectReaderGate,
  ProviderRotationLinkMap,
  PurgeReceipt,
  PurgeStep,
  SecretLocationReport,
  SecretOccurrence,
  SecretPurgeEngineOptions,
  StructuredLogEvent,
  StructuredLogSink,
} from "./types.js";

export { PurgeLockUnavailableError, SecretTooShortError } from "./types.js";
