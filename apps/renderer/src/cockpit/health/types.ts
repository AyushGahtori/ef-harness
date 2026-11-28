/** Five operational alarms plus the calm Pool 2 wait pill. */
export const HEALTH_SIGNAL_KINDS = [
  "stuck_no_progress",
  "loop_detected",
  "rate_limited_backoff",
  "allowance_window_wait",
  "escalated_or_retrying",
  "waiting_run_slot",
] as const;

export type HealthSignalKind = (typeof HEALTH_SIGNAL_KINDS)[number];

export function alarmKindOf(kind: HealthSignalKind): AlarmSignalKind | null {
  switch (kind) {
    case "stuck_no_progress":
    case "loop_detected":
    case "rate_limited_backoff":
    case "allowance_window_wait":
    case "escalated_or_retrying":
      return kind;
    case "waiting_run_slot":
      return null;
    default: {
      const unexpected: never = kind;
      return unexpected;
    }
  }
}

/** Alarm kinds never include the calm run-slot pill. */
export const ALARM_SIGNAL_KINDS = [
  "stuck_no_progress",
  "loop_detected",
  "rate_limited_backoff",
  "allowance_window_wait",
  "escalated_or_retrying",
] as const;

export type AlarmSignalKind = (typeof ALARM_SIGNAL_KINDS)[number];

export const BADGE_TONES = ["amber", "violet", "red"] as const;
export type BadgeTone = (typeof BADGE_TONES)[number];

export const SUPPRESSION_REASONS = [
  "pool2_run_slot",
  "inbox_reply",
  "task_hold",
  "rate_limit_backoff",
  "allowance_reset",
] as const;

export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

export const MODEL_TIERS = ["Junior", "Mid", "Senior", "Manager"] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];

export const POOL_STATES = ["running", "thinking", "waiting_run_slot"] as const;
export type PoolState = (typeof POOL_STATES)[number];

export const PACING_STATES = [
  "normal",
  "burn_paced",
  "backoff_429",
  "window_exhausted",
] as const;
export type PacingState = (typeof PACING_STATES)[number];

export const STEP_KINDS = ["tool", "edit", "undo", "test", "token", "other"] as const;
export type StepKind = (typeof STEP_KINDS)[number];

/** No forward step for this long, and only then, may raise the stuck clock. */
export const STUCK_THRESHOLD_MS = 300_000;

/** Local countdown cadence. Ticks must not pull daemon telemetry. */
export const COUNTDOWN_TICK_MS = 1_000;

/** Reserved card slot height so badges never shift the board (CLS = 0). */
export const HEALTH_BADGE_SLOT_HEIGHT_PX = 24;

export interface ProgressMarks {
  readonly fileEdits: number;
  readonly completedToolCalls: number;
  readonly tokenChunks: number;
  readonly lastFileEditAtMs: number | null;
  readonly lastCompletedToolCallAtMs: number | null;
  readonly lastTokenChunkAtMs: number | null;
}

/** Local port of Task 053 NativeWorkerLoop loop/step telemetry. */
export interface LoopDetectorReading {
  readonly identicalFailingToolInvocations: number;
  readonly editUndoOscillations: number;
  readonly repeatingTestErrorFingerprints: number;
  readonly errorSnippet: string | null;
}

/** One worker-loop step the local loop counter can read without Task 053 linked. */
export interface WorkerStep {
  readonly index: number;
  readonly kind: StepKind;
  readonly fingerprint: string;
  readonly failed: boolean;
  readonly toolName: string | null;
  readonly errorSnippet: string | null;
}

/** Local port of Task 059 VerificationHintLadder. */
export interface HintLadderReading {
  readonly hintLevel: 0 | 1 | 2 | 3;
  readonly attemptLimit: number;
  readonly escalatedTo: ModelTier | null;
  readonly disputeTest: boolean;
  readonly retriesExhausted: boolean;
  readonly failedAttempts: number;
}

/** Provider pacing (Task 140) or an HTTP 429 Retry-After deadline. */
export interface BackoffReading {
  readonly active: boolean;
  readonly retryAtMs: number;
  readonly source: "provider_pacing" | "http_429";
}

export interface AllowanceReading {
  readonly active: boolean;
  readonly providerLabel: string;
  readonly resetAtMs: number;
  readonly window: "five_hour" | "weekly";
}

export interface HoldReading {
  readonly active: boolean;
  readonly reason: string;
}

export interface InboxWaitReading {
  readonly active: boolean;
}

export interface TimelineEvent {
  readonly id: string;
  readonly seq: number;
  readonly atMs: number;
  readonly summary: string;
}

/**
 * Structured daemon telemetry for one task. Detection is pure over this snapshot.
 * Sibling packages are not on this branch; this is the local port of their readings.
 */
export interface WorkerHealthTelemetry {
  readonly taskId: string;
  readonly attemptId: string;
  readonly connectionId: string;
  readonly active: boolean;
  readonly inspected: boolean;
  readonly startedAtMs: number;
  readonly poolState: PoolState;
  readonly poolWaitSinceMs: number | null;
  readonly progress: ProgressMarks;
  readonly steps: readonly WorkerStep[];
  readonly loop: LoopDetectorReading;
  readonly hint: HintLadderReading;
  readonly backoff: BackoffReading | null;
  readonly allowance: AllowanceReading | null;
  readonly hold: HoldReading | null;
  readonly inbox: InboxWaitReading | null;
  readonly timeline: readonly TimelineEvent[];
  readonly failingSnippet: string | null;
  readonly requirementSnippet: string | null;
  readonly pacingState: PacingState;
}

export interface HealthBoardSnapshot {
  readonly nowMs: number;
  readonly workers: readonly WorkerHealthTelemetry[];
}

export interface RemediationAction {
  readonly id: string;
  readonly label: string;
  readonly signalKind: HealthSignalKind;
  readonly destructive: false;
  readonly opensModal: false;
}

export interface HealthSignal {
  readonly kind: HealthSignalKind;
  readonly variant: string;
  readonly alarm: boolean;
  readonly tone: BadgeTone;
  readonly label: string;
  readonly clusterLabel: string | null;
  readonly taskId: string;
  readonly connectionId: string;
  readonly attemptId: string;
  readonly detail: string | null;
  readonly actions: readonly RemediationAction[];
  readonly flashing: false;
  readonly modal: false;
  readonly inline: true;
  readonly stealsFocus: false;
}

export interface WorkerHealthDetection {
  readonly taskId: string;
  readonly connectionId: string;
  readonly attemptId: string;
  readonly signals: readonly HealthSignal[];
  readonly suppressions: readonly SuppressionReason[];
  readonly stuck: boolean;
}

export interface BoundedExplainerFacts {
  readonly contractId: "cockpit-explainer@1";
  readonly taskId: string;
  readonly lastEventSeq: number;
  readonly timeline: readonly TimelineEvent[];
  readonly failingTestOrErrorSnippet: string;
  readonly retryHintLevel: number;
  readonly activeHolds: readonly string[];
  readonly providerPacingState: PacingState;
  readonly requirementSnippet: string;
}

export interface ExplanationBullets {
  readonly whatItWasTryingToDo: string;
  readonly whyItStalledOrFailed: string;
  readonly recommendedNextClick: string;
}

export interface CockpitExplanation {
  readonly taskId: string;
  readonly lastEventSeq: number;
  readonly source: "model" | "cache" | "deterministic_fallback";
  readonly tokensUsed: number;
  readonly cacheHit: boolean;
  readonly bullets: ExplanationBullets;
  readonly citedEventIds: readonly string[];
  readonly citationsVerified: boolean;
  readonly modelRejected: false | "essay" | "unknown_event_id" | "malformed" | "blocked" | "provider";
  readonly backgroundCall: false;
  readonly facts: BoundedExplainerFacts;
}

export type HealthMetricEvent =
  | {
      readonly event: "health_signal_triggered";
      readonly signal: AlarmSignalKind;
      readonly variant: string;
      readonly taskId: string;
      readonly connectionId: string;
      readonly atMs: number;
    }
  | {
      readonly event: "health_signal_resolved";
      readonly signal: AlarmSignalKind;
      readonly variant: string;
      readonly taskId: string;
      readonly connectionId: string;
      readonly atMs: number;
      readonly durationMs: number;
    };

export interface TelemetryMetricRow {
  readonly attempt: string | null;
  readonly ts: number;
  readonly kind: "metric";
  readonly data: string;
}

export interface TelemetryMetricWriter {
  insertMetric(row: TelemetryMetricRow): void;
}

/** Daemon pull used only when the board explicitly refreshes, never on a 1 Hz tick. */
export interface HealthDaemonPort {
  pullHealthSnapshot(): HealthBoardSnapshot;
}
