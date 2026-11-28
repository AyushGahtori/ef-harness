export const packageName = "@ef-harness/providers" as const;
export const layer = 3 as const;

export function packageIdentity(): {
  readonly name: typeof packageName;
  readonly layer: typeof layer;
} {
  return { name: packageName, layer };
}

export {
  ApiConnectionManager,
  LocalBudgetLedger,
  LocalGlobalDbConnections as ApiKeyGlobalDbConnections,
  ZeroTokenApiKeyValidator,
} from "./api-keys/index.js";
export {
  ANTHROPIC_COMPLIANCE_MESSAGE,
  CompliancePolicyLocks,
  SignedProviderPolicyEngine,
} from "./policy/index.js";
export {
  NoSilentPaidFallbackGuard,
  evaluateScreenFallback,
} from "./fallback-guard/index.js";
export * as fallbackGuard from "./fallback-guard/index.js";
export { SignInWithChatGptAuthFlow } from "./siwc/index.js";
export { BrokerOpenRouterConnections, BrokerOpenRouterVault } from "./openrouter-local/index.js";
export {
  CursorBrowserAuthFlow,
  GitHubCopilotDeviceAuthFlow,
  LocalGlobalDbConnections,
  LocalWindowsDpapiSecretsVault,
} from "./copilot-cursor-auth/index.js";
export {
  AllowancePacingController,
  BrokerGlobalConnectionWindowRepo,
  PacingAllowanceWindow,
  applyAllowanceWeights,
  rosterWithPolicyAndPacing,
} from "./pacing/index.js";
export * as apiKeys from "./api-keys/index.js";
export * as copilotCursorAuth from "./copilot-cursor-auth/index.js";
export * as openrouterLocal from "./openrouter-local/index.js";
export * as pacing from "./pacing/index.js";
export * as policy from "./policy/index.js";
export * as siwc from "./siwc/index.js";
export * as signInWithChatGpt from "./siwc/index.js";
