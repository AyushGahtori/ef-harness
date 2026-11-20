export {
  EmptySlotAclManager,
  capabilitySidForSlot,
  evaluateCrossWorktreeRead,
  grantRelaxesDeveloperHome,
} from "./acl.js";
export { compileTierBPolicy, evaluateTierBAccess } from "./access.js";
export {
  DEFAULT_OFFLINE_SID,
  DEFAULT_ONLINE_SID,
  SANDBOX_ACCOUNTS,
  SANDBOX_OFFLINE_ACCOUNT,
  SANDBOX_ONLINE_ACCOUNT,
  TIER_B_CAPABILITIES,
  VENDOR_SDK_FIELD,
  VENDOR_TOKEN_ENV,
  VOLUME_GUIDANCE,
} from "./constants.js";
export { buildDesktopIsolation } from "./desktop.js";
export {
  buildScrubbedEnvironment,
  cacheLayout,
  injectSingleVendorToken,
  redirectsAreInsideTemp,
  resolveTierBExecutionMode,
} from "./env.js";
export type { EnvRedirects, EnvSource } from "./env.js";
export {
  ConsentRequiredError,
  CreateProcessAsUserError,
  DeveloperHomeAclError,
  EmptySlotMissingError,
  EmptySlotNotEmptyError,
  ProvisionFailedError,
  SlotGrantMissingError,
  TierBCommandTimeoutError,
  TierBError,
  TierBModeSRequiredError,
  TierBPoolError,
  TierBUnavailableError,
  VolumeRejectedError,
} from "./errors.js";
export {
  buildTierBFirewallRules,
  evaluateTierBNetwork,
  excludedPortRanges,
  firewallRuleHash,
  firewallSpecHash,
  formatPortRanges,
  netshAddRuleArgs,
  rangeCovers,
} from "./firewall.js";
export { readWindowsTierBInspector } from "./host.js";
export {
  MemoryAuditLog,
  MemoryGovernor,
  MemoryJobManager,
  RecordingAclPort,
  RecordingLogonExecutor,
  RecordingScriptRunner,
  RefusingLogonExecutor,
  RefusingScriptRunner,
  nearestRankPercentile,
  readyInspector,
} from "./memory.js";
export { generateSandboxPassword, passwordLooksStrong } from "./password.js";
export { probeTierB } from "./probe.js";
export { explainCreateProcessAsUserFailure, explainProvisionFailure } from "./provision-errors.js";
export { TierBAdminProvisioner, renderDeprovisionScript, renderProvisionScript } from "./provisioner.js";
export { createTierBSandboxUsersProvider, TierBSandboxUsersProvider } from "./provider.js";
export type { TierBSandboxUsersProviderOptions } from "./provider.js";
export { runTierBLiveRedTeam, tierBLiveOptIn } from "./redteam.js";
export { buildRestrictedLogonPlan, selectSandboxAccount } from "./spawn.js";
export type {
  AclAce,
  AclCommand,
  AclPort,
  AccessDecision,
  CommandResult,
  CommandSpec,
  CompiledTierBPolicy,
  DeprovisionPlan,
  DesktopIsolationPlan,
  FirewallRuleSpec,
  LiveRedTeamReport,
  LogonExecutor,
  ProcessAsUserDiagnostic,
  ProtectedSecret,
  ProvisionExplanation,
  ProvisionPlan,
  RestrictedLogonPlan,
  SandboxInstance,
  SandboxLaunchSpec,
  SandboxTier,
  SandboxTierProvider,
  ScriptRunner,
  SecretProtector,
  SettingsConsent,
  SlotGrant,
  TierBHostInspector,
  TierBModeDecision,
  TierBProbe,
  TierCapabilityFlags,
  TierProbeResult,
  VolumeAssessment,
  VolumeInfo,
  WindowsJobManagerPort,
  WrappedProcessHandle,
  WrappedProcessSpec,
  WrappedVendor,
} from "./types.js";
export { MemorySecretProtector, sandboxUserCanDecryptDeveloperDpapi } from "./vault.js";
export { assessVolume, assertTierBVolume, probeTierBForPath } from "./volume.js";
