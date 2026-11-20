export { packageInstallCommand, isWorkerPackageManagerInstall, renderCommand } from "./commands.js";
export {
  InstallerError,
  TierCInstallDenied,
  WorkerDirectInstallDenied,
  LockfileIntegrityError,
  SandboxRedTeamError,
  RegistryProfileError,
  LockfileMutationError,
} from "./errors.js";
export { createGuardedJobRunner, spawnInstallerCommand, isSecretPath } from "./guard.js";
export { KernelPackageInstaller } from "./installer.js";
export { verifyLockfileIntegrity, DEFAULT_REGISTRY_HOSTS, tarballHostAllowed, readLockfilePackages } from "./lockfile.js";
export { POPULAR_PACKAGES } from "./popular-packages.js";
export { reconcileDependencyIntents } from "./reconcile.js";
export { DEFAULT_LICENSE_POLICY, evaluateLicense } from "./spdx.js";
export {
  DiskLane,
  sharedDiskLane,
  alignStoreWithWorktree,
  ensureStoreDirectory,
  markNodeModulesReadOnly,
  storeHasIntegrity,
  chmodWritable,
} from "./store.js";
export { checkTyposquat, damerauLevenshtein } from "./typosquat.js";
export { vetDependencyIntent, resolvePackageVersion, DEFAULT_MIN_AGE_HOURS, EMPTY_ADVISORIES } from "./vet.js";
export type {
  AddDependencyRequest,
  AdvisoryRecord,
  AdvisorySource,
  ApplyReconciledRequest,
  DependencyAuditReceipt,
  DependencyConflict,
  DependencyIntent,
  DependencyReconciliation,
  InstallActor,
  InstallOutcome,
  InstallScriptApprovalRequired,
  InstallTier,
  InstalledPackageReceipt,
  InstallerCommandRequest,
  InstallerCommandResult,
  InstallerJobRunner,
  IntegrityCheckOptions,
  KernelInstallerProxy,
  KernelPackageInstallerOptions,
  LicenseCheck,
  LicensePolicy,
  LifecycleScripts,
  LockfileIntegrityFailure,
  LockfileIntegrityReport,
  LockfilePackageRecord,
  MergedDependencyUpdate,
  NetworkPolicyProfile,
  PackageManager,
  PackageMetadataSource,
  PackageVersionMetadata,
  SandboxTier,
  StoreAlignment,
  SupplyChainVetReport,
  TyposquatMatch,
  TyposquatReason,
  VulnerabilityFinding,
} from "./types.js";
