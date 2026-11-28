export const ROUTE_STATUSES = [
  "allowed",
  "opt_in_with_notice",
  "disabled_by_policy",
  "route_revoked",
] as const;

export type RouteComplianceStatus = (typeof ROUTE_STATUSES)[number];

export const CLI_RUNTIMES = [
  "codex",
  "claude",
  "copilot",
  "cursor-agent",
  "opencode",
  "gemini",
] as const;

export type CliRuntime = (typeof CLI_RUNTIMES)[number];

export const MODEL_TIERS = ["junior", "mid", "senior", "principal"] as const;

export type ModelTier = (typeof MODEL_TIERS)[number];

export const BILLING_KINDS = ["api_key", "plan", "local"] as const;

export type BillingKind = (typeof BILLING_KINDS)[number];

export const CLI_GATE_EFFECTS = ["disabled", "observe-only"] as const;

export type CliGateEffect = (typeof CLI_GATE_EFFECTS)[number];

export interface SiwcPreviewConstraints {
  scope: string;
  store: boolean;
  stream: boolean;
  forbiddenRequestFields: string[];
  persistExtAgentHostId: boolean;
}

export interface PolicyRoute {
  id: string;
  provider: string;
  authFlow: string;
  status: RouteComplianceStatus;
  billing: BillingKind;
  revocationNotice: string | null;
  alternatives: string[];
  defaultEnabled: boolean;
  invocation: string | null;
  notice: string | null;
  readsCredentialDirectory: boolean;
  consoleKeyOnly: boolean;
  constraints: SiwcPreviewConstraints | null;
}

export interface CliDenylistRange {
  from: string;
  to: string;
  effect: CliGateEffect;
  reason: string;
}

export interface CliFloor {
  runtime: CliRuntime;
  minVersion: string;
  denylist: CliDenylistRange[];
}

export interface PolicyModel {
  modelId: string;
  family: string;
  provider: string;
  tier: ModelTier;
  contextWindow: number;
  supportsTools: boolean;
  supportsStructuredJson: boolean;
  supportsVision: boolean;
  inputMicroUsdPer1M: number;
  outputMicroUsdPer1M: number;
  cachedInputMicroUsdPer1M: number;
  defaultPassPriors: Record<string, number>;
  deprecatedAfter: string | null;
  replacementModelId: string | null;
  revoked: boolean;
}

export interface ComplianceDeclaration {
  immutable: boolean;
  anthropicConsoleOnly: boolean;
  subscriptionOauthWithdrawn: boolean;
  geminiCliDefaultEnabled: boolean;
  geminiRequiresExplicitOptIn: boolean;
  geminiInvocation: string;
  geminiNotice: string;
  geminiReadsCredentialDirectory: boolean;
  forbiddenVendorDenied: boolean;
  siwc: SiwcPreviewConstraints;
}

export interface PolicySignature {
  alg: "Ed25519";
  keyId: string;
  sig: string;
}

export interface UnsignedProviderPolicy {
  policyVersion: number;
  publishedAt: string;
  refreshUrl: string;
  compliance: ComplianceDeclaration;
  routes: PolicyRoute[];
  cliFloors: CliFloor[];
  models: PolicyModel[];
}

export interface ProviderPolicyDocument extends UnsignedProviderPolicy {
  signature: PolicySignature;
}

export interface PolicyHistoryRecord {
  policyVersion: number;
  publishedAt: string;
  sha256: string;
  appliedAt: string;
  diffSummary: string;
}

export interface ConnectionRecord {
  id: string;
  provider: string;
  route: string;
  currency: string;
  enabled: boolean;
  billing: BillingKind;
}

export interface ActiveAtomicStep {
  stepId: string;
  connectionId: string;
  routeId: string;
  checkpointed: boolean;
  corrupted: boolean;
}

export interface AccountCardAction {
  id: "switch_connection" | "keep_parked";
  label: "Switch Connection" | "Keep Parked";
}

export interface AccountCard {
  cardId: string;
  kind: "route_revoked";
  routeIds: string[];
  connectionIds: string[];
  revocationNotice: string;
  actions: AccountCardAction[];
  silentPaidFallback: false;
}

export interface RosterModelRecord {
  modelId: string;
  family: string;
  provider: string;
  tier: ModelTier;
  contextWindow: number;
  supportsTools: boolean;
  supportsStructuredJson: boolean;
  supportsVision: boolean;
  inputMicroUsdPer1M: number;
  outputMicroUsdPer1M: number;
  cachedInputMicroUsdPer1M: number;
  defaultPassPriors: Record<string, number>;
  deprecatedAfter: string | null;
  replacementModelId: string | null;
  revoked: boolean;
  origin: "policy" | "user" | "ollama" | "lmstudio";
  pinnedByUser: boolean;
}

export interface ModelReferenceResolution {
  found: boolean;
  record: RosterModelRecord | null;
  selectable: boolean;
  replacementModelId: string | null;
  recommendation: string | null;
}

export type ApplyReason =
  | "applied"
  | "unchanged"
  | "invalid_signature"
  | "rollback"
  | "compliance_lock"
  | "malformed"
  | "offline"
  | "throttled";

export interface ApplyResult {
  applied: boolean;
  reason: ApplyReason;
  policyVersion: number;
  detail: string | null;
  card: AccountCard | null;
}

export interface PolicyTransparencyRoute {
  routeId: string;
  complianceStatus: RouteComplianceStatus;
}

export interface PolicyTransparencyView {
  policyVersion: number;
  lastVerifiedAt: string | null;
  lastCheckedAt: string | null;
  diagnosticLine: string;
  routes: PolicyTransparencyRoute[];
}

export interface CliGateDecision {
  runtime: string;
  installedVersion: string;
  status: "allowed" | "disabled" | "observe-only";
  launchCodingTasks: boolean;
  reason: "ok" | "below_minimum" | "denylisted" | "unparseable" | "unknown_runtime" | "missing_floor";
  title: string;
  card: string;
}

export interface DispatchDecision {
  allowed: boolean;
  reason: "ok" | "route_revoked";
  card: AccountCard | null;
}

export interface SilentFallbackDecision {
  accepted: boolean;
  reason: "ok" | "no_silent_paid_fallback" | "target_revoked";
}

export type PriceTableProvider = "anthropic" | "openai" | "openrouter" | "gemini";

export interface PolicyPriceModel {
  modelId: string;
  provider: PriceTableProvider;
  inputMicroUsdPer1M: bigint;
  outputMicroUsdPer1M: bigint;
  cachedInputReadMicroUsdPer1M: bigint;
  cacheWriteMicroUsdPer1M: bigint;
  reasoningTokenMicroUsdPer1M: bigint;
}

export interface PolicyPriceTable {
  version: string;
  models: PolicyPriceModel[];
}

export interface CopilotPremiumMultiplier {
  modelId: string;
  multiplier: 0 | 1 | 3;
  kind: "included" | "standard" | "premium_reasoning";
}

export interface SiwcPolicyView {
  routeRevoked: boolean;
  registerDynamicClient: boolean;
  staticClientId: string | null;
  authorizeEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint: string;
  discoveryUrl: string;
  jwksUri: string;
  issuer: string;
  resource: string;
  responsesEndpoint: string;
  agentNameHint: string;
  requestedScopes: readonly string[];
  fallbackGuidance: string;
}
