export interface Clock {
  now(): number;
}

export interface TimerRegistry {
  set(callback: () => void, ms: number): number;
  clear(handle: number): void;
  activeCount(): number;
}

export interface AbortableSleep {
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}

export interface UserAgentActions {
  copy(text: string): void;
  openExternal(url: string, channel: "os_browser"): void;
}

export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CommandRunner {
  run(argv: readonly string[]): Promise<CommandResult>;
}

export interface CliToolAuth {
  readonly installed: boolean;
  readonly version: string | null;
  readonly authenticated: boolean;
  readonly login: string | null;
  readonly token: string | null;
}

export interface CliAuthSnapshot {
  readonly gh: CliToolAuth;
  readonly copilot: CliToolAuth;
}

export interface CliAuthProbe {
  probe(): Promise<CliAuthSnapshot>;
}

export interface CliReuseOffer {
  readonly source: "gh" | "copilot";
  readonly login: string;
  readonly version: string;
  readonly label: string;
}

export interface GitHubDeviceHttp {
  post(input: {
    readonly url: string;
    readonly body: Readonly<Record<string, string>>;
  }): Promise<unknown>;
}

export interface DeviceCodeGrant {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly expiresInSec: number;
  readonly intervalSec: number;
}

export type DevicePollResult =
  | { readonly status: "authorization_pending" }
  | { readonly status: "slow_down" }
  | { readonly status: "expired_token" }
  | { readonly status: "access_denied"; readonly message: string }
  | { readonly status: "success"; readonly accessToken: string };

export type CopilotBillingMode = "copilot_subscription" | "byok_api_key";

export type SeatDecision =
  | {
      readonly ok: true;
      readonly login: string;
      readonly plan: string;
      readonly allowedModels: readonly string[];
      readonly billingMode: CopilotBillingMode;
      readonly orgPolicyMessage: string | null;
    }
  | {
      readonly ok: false;
      readonly code: "no_copilot_entitlement";
      readonly login: string;
      readonly message: string;
    }
  | {
      readonly ok: false;
      readonly code: "org_policy";
      readonly message: string;
    };

export interface CopilotSeatHttpBody {
  readonly code?: string;
  readonly message?: string;
  readonly entitlement?: boolean;
  readonly login?: string;
  readonly plan?: string;
  readonly allowedModels?: readonly string[];
  readonly billingMode?: string;
  readonly orgPolicyMessage?: string;
}

export interface CopilotSeatVerifier {
  verifySeat(accessToken: string): Promise<SeatDecision>;
}

export interface CopilotQuota {
  readonly entitlement: number;
  readonly remaining: number;
  readonly percentRemaining: number;
  readonly resetDateUtc: string;
  readonly overageEnabled: boolean;
}

export interface CopilotAccountClient {
  accountGetQuota(accessToken: string): Promise<CopilotQuota>;
}

export type QuotaReadReason = "connection_verify" | "build_start" | "periodic";

export interface SecretWriteResult {
  readonly secretId: string;
  readonly lastFourMasked: string;
}

export interface SecretPublicMetadata {
  readonly secretId: string;
  readonly name: string;
  readonly providerHint: "github_copilot" | "cursor";
  readonly lastFourMasked: string;
}

export interface WindowsDpapiSecretsVault {
  writeSecret(input: {
    readonly secretId: string;
    readonly name: "gitHubToken" | "cursorUserApiKey";
    readonly plaintext: string;
    readonly providerHint: "github_copilot" | "cursor";
  }): Promise<SecretWriteResult>;
  readSecret(secretId: string): Promise<string | null>;
  deleteSecret(secretId: string): Promise<void>;
  exportAtRest(): string;
  listPublicMetadata(): readonly SecretPublicMetadata[];
}

export interface CursorReminderState {
  readonly sevenDayEmitted: boolean;
  readonly sevenDayAcknowledged: boolean;
  readonly urgentEmitted: boolean;
  readonly urgentAcknowledged: boolean;
}

export interface CopilotConnectionMetadata {
  readonly kind: "copilot";
  readonly authMode: "github_device_flow" | "github_cli_reuse";
  readonly billingMode: CopilotBillingMode;
  readonly accountLogin: string;
  readonly allowedModels: readonly string[];
  readonly orgPolicyMessage: string | null;
  readonly maskedPreview: string;
  readonly verifiedAt: number;
  readonly status: "active";
  readonly overageApprovedForReset: string | null;
}

export interface CursorConnectionMetadata {
  readonly kind: "cursor";
  readonly authMode: "cursor_browser";
  readonly billingMode: "cursor_subscription";
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly maskedPreview: string;
  readonly verifiedAt: number;
  readonly status: "active" | "expired" | "unauthorized";
  readonly modelCount: number;
  readonly chargedCents: number;
  readonly reminder: CursorReminderState;
}

export type ConnectionMetadata = CopilotConnectionMetadata | CursorConnectionMetadata;

export interface GlobalConnectionRecord {
  readonly id: string;
  readonly provider: "github_copilot" | "cursor";
  readonly route: "copilot_sdk" | "cursor_sdk";
  readonly plan: string | null;
  readonly vaultRef: string | null;
  readonly currency: string;
  readonly scale: number;
  readonly enabled: 0 | 1;
  readonly createdAt: number;
  readonly metadata: ConnectionMetadata;
}

export interface GlobalDbConnectionsPort {
  upsert(record: GlobalConnectionRecord): void;
  update(id: string, patch: (current: GlobalConnectionRecord) => GlobalConnectionRecord): void;
  get(id: string): GlobalConnectionRecord | null;
  delete(id: string): void;
  list(): readonly GlobalConnectionRecord[];
  exportSnapshot(): string;
}

export interface CopilotModelMultiplier {
  readonly modelId: string;
  readonly multiplier: 0 | 1 | 3;
  readonly kind: "included" | "standard" | "premium_reasoning";
}

export interface SignedProviderPolicyEnginePort {
  copilotPremiumMultipliers(): readonly CopilotModelMultiplier[];
}

export type RosterPreset = "balanced" | "cheapest" | "strongest";
export type TaskDifficulty = "junior" | "mid" | "senior" | "manager";

export interface CopilotWeightedModelChoice {
  readonly modelId: string;
  readonly multiplier: 0 | 1 | 3;
  readonly kind: CopilotModelMultiplier["kind"];
  readonly preset: RosterPreset;
  readonly difficulty: TaskDifficulty;
  readonly routine: boolean;
  readonly savesPremiumRequests: boolean;
  readonly task106Roster: {
    readonly connectionRoute: "copilot_sdk";
    readonly modelId: string;
    readonly premiumRequestMultiplier: 0 | 1 | 3;
  };
  readonly task140Weight: {
    readonly multiplier: 0 | 1 | 3;
    readonly paceAsPremium: boolean;
  };
}

export interface CopilotPacingSignal {
  readonly connectionId: string;
  readonly provider: "github_copilot";
  readonly billingMode: CopilotBillingMode;
  readonly reason: QuotaReadReason;
  readonly entitlement: number;
  readonly remaining: number;
  readonly percentRemaining: number;
  readonly resetDateUtc: string;
  readonly overageEnabled: boolean;
  readonly analyticsCurrency: "premium_requests" | "api_usd";
  readonly subscriptionQuotaApplies: boolean;
  readonly dispatch: "allow" | "park" | "pause_for_confirmation" | "allow_paid_overage";
}

export interface CopilotPacingFeed {
  onQuota(signal: CopilotPacingSignal): void;
}

export interface CopilotCheckpointStopCard {
  readonly kind: "checkpoint_stop";
  readonly connectionId: string;
  readonly message: string;
  readonly actions: readonly ["Switch to 0x included model", "Switch Connection", "Keep Parked"];
}

export interface CheckpointStopNotifier {
  open(card: CopilotCheckpointStopCard): void;
}

export interface CursorLoginRequest {
  readonly signal: AbortSignal;
  openBrowser(url: string): void;
}

export type CursorUsageProbe =
  | { readonly ok: true; readonly chargedCents: number }
  | { readonly ok: false; readonly status: number; readonly message: string };

export type CursorModelProbe =
  | { readonly ok: true; readonly models: readonly string[] }
  | { readonly ok: false; readonly status: number; readonly message: string };

export interface CursorAuthLoginPort {
  login(request: CursorLoginRequest): Promise<{ readonly userApiKey: string }>;
  getUsage(userApiKey: string): Promise<CursorUsageProbe>;
  probeModels(userApiKey: string): Promise<CursorModelProbe>;
}

export interface ExpiryReminderCard {
  readonly kind: "fyi_account_reminder";
  readonly connectionId: string;
  readonly blocking: false;
  readonly tone: "calm";
  readonly phase: "seven_day" | "urgent";
  readonly message: string;
  readonly actionLabel: "Refresh now";
}

export interface AccountCardNotice {
  readonly kind: "AccountCard";
  readonly connectionId: string;
  readonly blocking: true;
  readonly actionLabel: "Re-sign in with Cursor";
  readonly reason: "expired" | "unauthorized";
}

export interface ReminderCardSink {
  emit(card: ExpiryReminderCard): void;
}

export interface AccountCardSink {
  emit(card: AccountCardNotice): void;
}

export interface CursorDispatchParker {
  park(event: {
    readonly connectionId: string;
    readonly reason: "expired" | "unauthorized";
  }): void;
}

export interface NoSilentPaidFallbackPort {
  refuseSilentPaidFallback(event: {
    readonly connectionId: string;
    readonly from: "cursor_subscription";
    readonly to: "paid_api_key";
  }): void;
}

export type SchedulerNotice =
  | { readonly kind: "reminder"; readonly card: ExpiryReminderCard }
  | { readonly kind: "account"; readonly card: AccountCardNotice };

export function emptyCursorReminder(): CursorReminderState {
  return {
    sevenDayEmitted: false,
    sevenDayAcknowledged: false,
    urgentEmitted: false,
    urgentAcknowledged: false,
  };
}

export function isVaultReference(value: string): boolean {
  return /^vault:[A-Za-z0-9:_-]{1,160}$/.test(value);
}

export function maskedPreview(lastFour: string): string {
  return `••••${lastFour}`;
}
