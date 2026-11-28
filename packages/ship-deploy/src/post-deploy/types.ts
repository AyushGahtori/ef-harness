/**
 * Local ports for sibling tasks that are not on this branch.
 * Wiring replacements are recorded in `.agent-handoffs/task-181.md`.
 */

export type DeployEnvironment = "preview" | "staging" | "production";

export type ShipRunState =
  | "WATCHING"
  | "WATCH_PAUSED"
  | "SHIPPED"
  | "ROLLED_BACK"
  | "AWAITING_PROD_ROLLBACK_APPROVAL"
  | "KEPT_LIVE"
  | "FAILED";

export type SchemaShipStatus =
  | "pending"
  | "running"
  | "passed"
  | "failed"
  | "cancelled"
  | "rolled_back";

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

export interface Clock {
  now(): number;
  wait(ms: number, signal?: AbortSignal): Promise<void>;
}

export interface TlsReport {
  readonly valid: boolean;
  readonly mode: "https" | "loopback-plaintext" | "plaintext-remote" | "unsupported";
  readonly expiresAt?: string;
  readonly reason?: string;
}

export type TlsProbe = (target: URL) => Promise<TlsReport>;

export interface PacketSecurityRedactor {
  redact(text: string): string;
  registerSecret(value: string, label: string): void;
}

export interface CasPutInput {
  readonly kind: "log" | "screenshot" | "trace";
  readonly text: string;
}

export interface CasBlobStore {
  put(input: CasPutInput): Promise<{ readonly id: string; readonly hash: string }>;
}

export interface DeployRollbackResult {
  readonly deploymentId: string;
  readonly liveUrl: string;
  readonly buildId: string;
}

/**
 * Task 179 `DeployAdapter.rollback`. The third argument is the effect id
 * created by Task 176 before any network call.
 */
export interface DeployAdapter {
  rollback(
    env: DeployEnvironment,
    previousDeploymentId: string,
    effectId: string,
  ): Promise<DeployRollbackResult>;
}

export type EffectApprovalStatus = "pending_approval" | "auto_allowed" | "approved";

export interface EffectIntent {
  readonly effectType: "rollback";
  readonly targetEnv: DeployEnvironment;
  readonly idempotencyKey: string;
  readonly canonicalPayload: Readonly<Record<string, string>>;
  readonly approvalStatus: EffectApprovalStatus;
}

export interface PlannedEffect {
  readonly effectId: string;
  readonly canonicalPayloadHash: string;
}

/** Task 176 `ExternalEffectLedger`. */
export interface ExternalEffectLedger {
  plan(intent: EffectIntent): Promise<PlannedEffect>;
  markDispatched(effectId: string): Promise<void>;
  markSucceeded(effectId: string, receipt: Readonly<Record<string, string>>): Promise<void>;
  markFailed(effectId: string, reason: string): Promise<void>;
}

/** Task 176 `EnvApprovalPolicyEngine` as it applies to rollback. */
export interface EnvApprovalPolicyEngine {
  rollbackDisposition(env: DeployEnvironment): "automatic" | "explicit_approval";
}

export interface ProductionRollbackCardAction {
  readonly id: "approve-rollback" | "keep-live";
  readonly label: string;
}

export interface ProductionRollbackCard {
  readonly cardId: string;
  readonly severity: "P0";
  readonly interruptNow: true;
  readonly shipRunId: string;
  readonly env: DeployEnvironment;
  readonly previousSha: string;
  readonly previousDeploymentId: string;
  readonly summary: string;
  readonly evidence: {
    readonly failingCheck: string;
    readonly consoleErrors: readonly string[];
    readonly redactedLogs: string;
    readonly screenshotSha256: string | null;
  };
  readonly actions: readonly [
    ProductionRollbackCardAction,
    ProductionRollbackCardAction,
  ];
}

/** Task 127 interrupt-now card sink. */
export interface ProductionAlertCardSink {
  raise(card: ProductionRollbackCard): Promise<{ readonly cardId: string }>;
}

export interface HealthCheckInput {
  readonly env: DeployEnvironment;
  readonly liveUrl: string;
  readonly expectedCommitSha: string;
  readonly healthPath?: string;
  readonly maxWaitMs?: number;
  readonly intervalMs?: number;
}

export interface HealthCheckResult {
  readonly liveUrl: string;
  readonly healthUrl: string;
  readonly buildId: string;
  readonly status: number;
  readonly tls: TlsReport;
  readonly attempts: number;
  readonly passedAt: string;
  readonly styleguideStatus: number | null;
}

export type AssetKind = "script" | "stylesheet" | "font" | "image";

export interface FailedAsset {
  readonly url: string;
  readonly status: number;
  readonly kind: AssetKind;
}

export interface SmokeRouteResult {
  readonly path: string;
  readonly status: number;
  readonly viewportWidth: number;
  readonly title: string;
  readonly shellMounted: boolean;
}

export interface SmokeNetworkHop {
  readonly method: "GET" | "HEAD";
  readonly url: string;
}

export interface DeployedSmokeReceipt {
  readonly passed: true;
  readonly viewports: readonly Viewport[];
  readonly routes: readonly SmokeRouteResult[];
  readonly consoleErrors: readonly string[];
  readonly failedAssets: readonly FailedAsset[];
  readonly brokenImages: readonly string[];
  readonly network: readonly SmokeNetworkHop[];
  readonly skippedSideEffectUrls: readonly string[];
  readonly receiptSha256: string;
  readonly screenshotSha256: string;
}

export interface SmokeCheckInput {
  readonly env: DeployEnvironment;
  readonly liveUrl: string;
  readonly publicRoutes?: readonly string[];
  readonly protectedRoutes?: readonly string[];
  readonly viewports?: readonly Viewport[];
}

export interface ReadOnlyPage {
  readonly viewport: Viewport;
  goto(
    path: string,
    options?: { readonly redirect?: "follow" | "manual" },
  ): Promise<{ readonly status: number; readonly contentType: string; readonly body: string }>;
  consoleErrors(): readonly string[];
  failedAssets(): readonly FailedAsset[];
  brokenImages(): readonly string[];
  networkLog(): readonly SmokeNetworkHop[];
  skippedSideEffectUrls(): readonly string[];
  screenshot(): Uint8Array;
  close(): Promise<void>;
}

/** Task 057 `UiPlaywrightContractVerifier` read-only deployed session. */
export interface UiPlaywrightContractVerifier {
  open(input: {
    readonly baseUrl: string;
    readonly viewport: Viewport;
    readonly readOnly: true;
  }): Promise<ReadOnlyPage>;
}

export interface HostLogSample {
  readonly requests: number;
  readonly fiveXx: number;
  readonly unhandledExceptions: number;
  readonly containerRestarts: number;
  readonly healthOk: boolean;
  readonly logLines: readonly string[];
}

/** Vercel metrics API or `docker logs --since` over SSH, polled by the watch. */
export interface HostObservabilitySource {
  readonly kind: "vercel-metrics" | "docker-logs";
  poll(input: {
    readonly deploymentId: string;
    readonly sinceIso: string;
    readonly pollCommand: string;
  }): Promise<HostLogSample>;
}

export interface LocalConnectivityProbe {
  isOnline(): boolean | Promise<boolean>;
}

export type WatchVerdict =
  | "clean"
  | "dismissed-early"
  | "paused-local-offline"
  | "breached";

export type WatchBreach =
  | { readonly kind: "consecutive-health-fails"; readonly count: number }
  | { readonly kind: "crash-loop"; readonly restarts: number }
  | {
      readonly kind: "five-xx-spike";
      readonly rate: number;
      readonly threshold: number;
    }
  | { readonly kind: "unhandled-exceptions"; readonly count: number; readonly threshold: number };

export interface WatchResult {
  readonly verdict: WatchVerdict;
  readonly pollCount: number;
  readonly logs: readonly string[];
  readonly minimized: boolean;
  readonly breach: WatchBreach | null;
  readonly logArtifactHash: string | null;
}

export type RegistrationType =
  | "dns-cname"
  | "dns-a"
  | "dns-txt"
  | "stripe-webhook"
  | "oauth-redirect"
  | "dkim"
  | "spf";

export interface RegistrationSpec {
  readonly shipRunId: string;
  readonly registrationType: RegistrationType;
  readonly targetUrlOrDomain: string;
  readonly expectedCname?: string;
  readonly expectedAddress?: string;
  readonly expectedTxtIncludes?: string;
  readonly dkimSelector?: string;
  readonly webhookUrl?: string;
  readonly signingEvents?: readonly string[];
  readonly oauthRedirectUri?: string;
  readonly allowSignedTestPing?: boolean;
  readonly attestationNote?: string;
}

export interface ExternalRegistrationReceipt {
  readonly shipRunId: string;
  readonly registrationType: RegistrationType;
  readonly targetUrlOrDomain: string;
  readonly probeStatus: "verified" | "attested";
  readonly verifiedAt: string | null;
  readonly evidence: string;
}

export type RegistrationProbeOutcome =
  | { readonly ok: true; readonly receipt: ExternalRegistrationReceipt }
  | { readonly ok: false; readonly probeStatus: "failed"; readonly evidence: string; readonly receipt: null };

export interface ProbeRequest {
  readonly kind: "dns-cname" | "dns-txt" | "dns-a" | "tls" | "https" | "webhook-test-ping";
  readonly target: string;
  readonly timeoutMs?: number;
}

export interface ProbeResponse {
  readonly ok: boolean;
  readonly values: readonly string[];
  readonly evidence: string;
  readonly expiresAt?: string;
  readonly status?: number;
}

/** Task 121 `HumanStepProbeRegistry`. */
export interface HumanStepProbeRegistry {
  run(request: ProbeRequest): Promise<ProbeResponse>;
}

export interface DnsProbePort {
  resolveCname(host: string): Promise<readonly string[]>;
  resolveTxt(host: string): Promise<readonly (readonly string[])[]>;
  resolve4(host: string): Promise<readonly string[]>;
}

export interface ShippedReleaseReceipt {
  readonly shipRunId: string;
  readonly env: DeployEnvironment;
  readonly commitSha: string;
  readonly liveUrl: string;
  readonly deploymentId: string;
  readonly healthPassedAt: string | null;
  readonly smokeReceiptSha: string | null;
  readonly tenMinWatchVerdict: string | null;
  readonly registrations: readonly ExternalRegistrationReceipt[];
  readonly rollbackTargetId: string | null;
  readonly state: ShipRunState;
}

export interface ShipRunRecord {
  readonly id: string;
  readonly kind: "deploy";
  readonly environment: DeployEnvironment;
  readonly headSha: string;
  readonly deploymentId: string;
  readonly url: string;
  readonly state: ShipRunState;
  readonly schemaStatus: SchemaShipStatus;
  readonly failureFingerprint: string | null;
  readonly updatedAt: number;
  readonly receipt: ShippedReleaseReceipt | null;
}

export interface PostDeployStateStore {
  saveShipRun(record: ShipRunRecord): void;
  getShipRun(id: string): ShipRunRecord | undefined;
  insertRegistration(receipt: ExternalRegistrationReceipt): void;
  registrationsFor(shipRunId: string): readonly ExternalRegistrationReceipt[];
}

export interface ReleaseOutcome {
  readonly state: ShipRunState;
  readonly receipt: ShippedReleaseReceipt;
  readonly rolledBack: boolean;
  readonly previousHealthy: boolean | null;
  readonly cardId: string | null;
  readonly notification: string;
  readonly minimized: boolean;
  readonly watchLogs: readonly string[];
}
