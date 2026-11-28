export const MICRO_USD_SCALE = 1_000_000;
export const PPM_SCALE = 1_000_000;
export const SUBSCRIPTION_WIND_DOWN_PPM = 900_000;
export const ADD_BUDGET_PLUS_5_MICRO_USD = 5_000_000;
export const ADD_BUDGET_PLUS_10_MICRO_USD = 10_000_000;
export const OPTIONAL_ADVISORY_ROLE_ID = "taste-reviewer@1";
export const MANDATORY_VERIFIER_ROLE_ID = "verifier@1";
export const METER_COLOR_50 = "#8FB4D9";
export const METER_TONE_50 = "soft-blue-neutral";
export const WIP_COMMIT_PREFIX = "[WIP - UNVERIFIED";

export const LADDER_STEPS = ["below", "info_50", "warning_80", "wind_down_90", "hard_stop_100"] as const;
export type LadderStep = (typeof LADDER_STEPS)[number];

export const STOP_TRIGGERS = ["budget_100", "window_exhausted", "user_stop", "disk_red"] as const;
export type StopTrigger = (typeof STOP_TRIGGERS)[number];

export const RECOVERY_ACTIONS = [
  "add_budget",
  "cheaper_models",
  "switch_connection",
  "wait_for_reset",
  "finish_by_hand",
  "keep_parked",
] as const;
export type RecoveryActionId = (typeof RECOVERY_ACTIONS)[number];

export type CurrencyKind = "micro-usd" | "ppm";
export type BillingKind = "subscription" | "pay-per-use" | "local";
export type CrewLevel = "junior" | "mid" | "senior" | "principal";
export type CrewPreset = "cheapest" | "balanced" | "fastest";
export type WindowKind = "5h" | "weekly";
export type HandoffPlacement = "commit" | "untracked" | "excluded";
export type MeterTone = "neutral" | "soft-blue-neutral" | "early-warning" | "wind-down" | "hard-stop";

export interface CurrencySnapshot {
  readonly currency: CurrencyKind;
  readonly spent: number;
  readonly reserved: number;
  readonly limit: number;
  readonly remaining: number;
  readonly committed: number;
  readonly percent: number;
  readonly step: LadderStep;
}

export interface LadderReading {
  readonly step: LadderStep;
  readonly percent: number;
  readonly sides: readonly CurrencySnapshot[];
}

export interface TopBarMeter {
  readonly tone: MeterTone;
  readonly color: string;
  readonly percent: number;
  readonly interruptionCount: number;
}

export interface DigestNotice {
  readonly channel: "digest";
  readonly subtle: boolean;
  readonly text: string;
}

export interface InboxNotice {
  readonly text: string;
}

export interface FilePayload {
  readonly path: string;
  readonly contents: string;
}

export interface QueuedTask {
  readonly taskId: string;
  readonly title: string;
  readonly featureId: string;
  readonly role: string;
  readonly mandatoryVerification: boolean;
  readonly currency: CurrencyKind;
  readonly ceilingUnits: number;
  readonly acceptanceCriteria: readonly string[];
  readonly safetyClass: string | null;
}

export interface ActiveWorker {
  readonly workerId: string;
  readonly taskId: string;
  readonly title: string;
  readonly featureId: string;
  readonly role: string;
  readonly currency: CurrencyKind;
  readonly ceilingUnits: number;
  readonly step: number;
  readonly steps: number;
  readonly files: readonly FilePayload[];
  readonly failingTestOutput: string | null;
  readonly acceptanceCriteria: readonly string[];
  readonly safetyClass: string | null;
  reservationId: string | null;
}

export interface ConnectionWindow {
  readonly kind: WindowKind;
  readonly resetAtMs: number;
}

export interface ConnectionAccount {
  readonly id: string;
  readonly label: string;
  readonly billing: BillingKind;
  readonly healthy: boolean;
  readonly estimateMicroUsd: number | null;
  readonly remainingTasks: number | null;
  readonly window: ConnectionWindow | null;
  readonly microUsdRemaining: number | null;
}

export interface AttemptCheckpoint {
  readonly taskId: string;
  readonly ref: string;
  readonly sha: string;
  readonly files: readonly FilePayload[];
  readonly failingTestOutput: string | null;
  readonly partial: true;
}

export interface CheckpointWrite {
  readonly taskId: string;
  readonly files: readonly FilePayload[];
  readonly failingTestOutput: string | null;
}

export interface IntegrationCommit {
  readonly sha: string;
  readonly featureId: string | null;
  readonly subject: string;
}

export interface StopEventRecord {
  readonly id: string;
  readonly trigger: StopTrigger;
  readonly timestampMs: number;
  readonly checkpointShas: readonly string[];
  readonly recoveryOption: RecoveryActionId | null;
}

export interface RecoveryActionModel {
  readonly id: RecoveryActionId;
  readonly label: string;
  readonly applicable: boolean;
  readonly enabled: boolean;
  readonly highlighted: boolean;
  readonly hidden: boolean;
  readonly detail: string;
}

export interface CheaperTaskLine {
  readonly taskId: string;
  readonly title: string;
  readonly floor: CrewLevel;
  readonly level: CrewLevel;
  readonly estimatedMicroUsd: number;
}

export interface CheaperProjection {
  readonly preset: "cheapest";
  readonly projectedRemainingMicroUsd: number;
  readonly lines: readonly CheaperTaskLine[];
}

export interface StopCardModel {
  readonly trigger: StopTrigger | "subscription_wind_down";
  readonly finishedFeatures: readonly string[];
  readonly finishedTasksCount: number;
  readonly inFlightCheckpointedTasks: readonly string[];
  readonly remainingTasksCount: number;
  readonly spentSummary: string;
  readonly officeLights: "day" | "evening";
  readonly actions: readonly RecoveryActionModel[];
  readonly cheaper: CheaperProjection;
  readonly confirmationTexts: readonly string[];
  readonly autoResumeAtReset: boolean;
  readonly vscodeCommand: string | null;
}

export interface ClaimResult {
  readonly claimed: boolean;
  readonly reason:
    | "claimed"
    | "wind_down"
    | "hard_stop"
    | "optional_advisory_skipped"
    | "reservation_denied"
    | "unknown_task";
  readonly reservationId: string | null;
  readonly windDown: boolean;
}

export interface ReserveResult {
  readonly ok: boolean;
  readonly reservationId: string | null;
  readonly reason: "held" | "over_ceiling";
  readonly windDown: boolean;
  readonly currency: CurrencyKind;
  readonly ceilingUnits: number;
}

export type AddBudgetChoice =
  | { readonly kind: "plus_5" }
  | { readonly kind: "plus_10" }
  | { readonly kind: "custom"; readonly customMicroUsd: number };

export interface RecoveryResult {
  readonly resumed: boolean;
  readonly reason: string | null;
  readonly confirmationText: string | null;
  readonly resumeFrom: readonly string[];
  readonly remainingMicroUsd: number | null;
  readonly remainingPpm: number | null;
  readonly projection: CheaperProjection | null;
}

export interface ParkState {
  readonly cpu: 0;
  readonly spendPerHourMicroUsd: 0;
  readonly welcomeBackReady: true;
  readonly checkpointRefs: readonly string[];
}

export interface WindDownSnapshot {
  readonly step: LadderStep;
  readonly meter: TopBarMeter;
  readonly digest: readonly DigestNotice[];
  readonly inbox: readonly InboxNotice[];
  readonly claimingEnabled: boolean;
  readonly optionalAdvisoriesSkipped: boolean;
  readonly mandatoryVerificationIntact: true;
  readonly interruptionCount: number;
  readonly officeLights: "day" | "evening";
  readonly stopCard: StopCardModel | null;
  readonly activeWorkerIds: readonly string[];
  readonly queuedTaskIds: readonly string[];
  readonly finishedFeatures: readonly string[];
  readonly finishedTasksCount: number;
  readonly parked: ParkState | null;
  readonly stopped: boolean;
  readonly preset: CrewPreset;
}

export interface DoneFeatureNote {
  readonly id: string;
  readonly title: string;
}

export interface RemainingTaskNote {
  readonly taskId: string;
  readonly title: string;
  readonly acceptanceCriteria: readonly string[];
}

export interface PartialTaskExport {
  readonly taskId: string;
  readonly title: string;
  readonly files: readonly FilePayload[];
  readonly failingTestOutput: string;
  readonly acceptanceCriteria: readonly string[];
}

export interface WipExportInput {
  readonly repoPath: string;
  readonly projectSlug: string;
  readonly date: string;
  readonly handoffPlacement: HandoffPlacement;
  readonly worktreeDirectory: string;
  readonly verifiedUnmergedShas: readonly string[];
  readonly partialTasks: readonly PartialTaskExport[];
  readonly done: readonly DoneFeatureNote[];
  readonly remaining: readonly RemainingTaskNote[];
  readonly testCommand: string;
  readonly previewCommand: string;
}

export interface WipExportResult {
  readonly branch: string;
  readonly worktreePath: string;
  readonly headSha: string;
  readonly integrationSha: string;
  readonly mainSha: string;
  readonly handoffPath: string;
  readonly handoffMarkdown: string;
  readonly openInVsCodeCommand: string;
  readonly wipCommits: readonly { readonly taskId: string; readonly sha: string; readonly subject: string }[];
  readonly fixedItMyself: {
    readonly compatible: true;
    readonly phrase: "I Fixed It Myself";
    readonly branch: string;
    readonly taskIds: readonly string[];
  };
}

export class BudgetStopError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BudgetStopError";
    this.code = code;
  }
}

export class CheckpointDiscardError extends BudgetStopError {
  constructor(message: string) {
    super("checkpoint_discard_blocked", message);
    this.name = "CheckpointDiscardError";
  }
}

export class ProtectedBranchExportError extends BudgetStopError {
  constructor(message: string) {
    super("protected_branch", message);
    this.name = "ProtectedBranchExportError";
  }
}
