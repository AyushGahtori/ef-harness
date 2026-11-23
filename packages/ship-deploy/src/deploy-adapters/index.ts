export type { DeployAdapter } from "./interface.js";
export { VercelDeployAdapter } from "./vercel-adapter.js";
export { DockerOverSshDeployAdapter } from "./docker-ssh-adapter.js";
export { NameOnlySyncEnvController } from "./name-only-sync-env.js";
export { DeployApprovalPolicyEngine } from "./approval-policy.js";
export { VercelHttpClient } from "./vercel-client.js";
export { InMemoryKnownHostsStore, assertPinnedHost } from "./known-hosts.js";
export { diffSecretNameHashes, formatApprovalLines } from "./name-diff.js";
export { assertShellSafeSegment, SHELL_SAFE_PATTERN } from "./validation.js";
export { assertDeployDispatchAllowed } from "./deploy-gate.js";
export type {
  DeployTargetEnv,
  DeployPlan,
  DeployOutcome,
  NameOnlyEnvDiff,
  EnvDiffPlan,
  SecretNameHash,
  VaultEnvSecret,
} from "./types.js";
export type {
  VaultNameHashPort,
  DeployApprovalPort,
  SshTransportPort,
  KnownHostsPort,
  VercelDeployPort,
  VercelRemoteEnvPort,
} from "./contracts.js";
export {
  DeployAdapterError,
  HostKeyConfirmationRequiredError,
  HostKeyMismatchError,
  LiveKeyPreviewBlockedError,
  TestKeyProductionBlockedError,
  ProductionRequiresExplicitApprovalError,
  ShellPathRejectedError,
  UnhealthySwapAbortedError,
  ArgvSecretLeakError,
} from "./errors.js";