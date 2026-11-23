export {
  OrphanBranchRehydrator,
  type OrphanBranchRehydrationResult,
} from "./orphan-branch-rehydrator.js";
export { PortableZipArchiveManager, type PortableZipManifest } from "./portable-zip-archive-manager.js";
export {
  CrossDeviceLeaseManager,
  type LocalLeaseContext,
  type TakeoverLeaseRequest,
  type TakeoverLeaseResult,
} from "./cross-device-lease-manager.js";
export { LostKeyOracleRegenerator, type LostKeyRegenerationCard } from "./lost-key-oracle-regenerator.js";
export { AgeSealedChecksDecryptor } from "./age-sealed-checks-decryptor.js";
export { ensureDeviceId, InMemoryGlobalDeviceIdentityStore } from "./device-identity.js";
export { computeCanonicalGraphSha256, sha256Hex, stableSortedJson } from "./canonical-graph.js";
export { HarnessStateReader } from "./harness-state-reader.js";
export { createNodeGitCommandPort } from "./git-commands.js";
export { assertHarnessStatePushAllowed, formatForceWithLeasePush } from "./force-push-guard.js";
export { createZipArchive, readZipArchive, assertSafeZipEntryPath } from "./zip-archive.js";
export {
  serializeEntity,
  serializeManifest,
  serializeLease,
  parseEntity,
  parseManifest,
  parseLease,
} from "./yaml-format.js";
export {
  ForcePushForbiddenError,
  LeaseTakeoverRaceError,
  RehydrationError,
  ZipImportError,
} from "./errors.js";
export type {
  ExportEntity,
  ExportManifest,
  EntityKind,
  HarnessStateTree,
  HistoryRecord,
  LeaseDocument,
  OpenModeDecision,
  ProjectOpenMode,
  RehydratedGraph,
  IndependentOracleAuthorSealerPort,
  GlobalDeviceIdentityPort,
  GitCommandPort,
} from "./types.js";