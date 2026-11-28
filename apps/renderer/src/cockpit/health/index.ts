export { allowanceActions, backoffActions, escalationActions, loopActions, recommendedClick, stuckActions, ALLOWANCE_CLUSTER_LABEL, STUCK_CLUSTER_LABEL } from "./actions.js";
export { HealthSignalBadgeStrip } from "./badge-strip.js";
export type { HealthBadgeView } from "./badge-strip.js";
export { attachHealthSlots, BOARD_HEALTH_SLOT_HEIGHT_PX } from "./board-slot.js";
export type { BoardCardHealthSlot } from "./board-slot.js";
export { detectWorkerHealth, lastForwardProgressAt } from "./detect.js";
export { BoardHealthSignalEngine } from "./engine.js";
export type { BoardHealthSignalEngineOptions, HealthBoardView, WorkerHealthView } from "./engine.js";
export { ExplainerProviderError, OnDemandCockpitExplainer, boundExplainerFacts, deterministicExplanation, lastEventSeq } from "./explainer.js";
export type { ExplainRequest, ExplainerModel } from "./explainer.js";
export { CockpitExplainerV1Schema, countSentences, ensureSentence, isOneSentence } from "./explainer-schema.js";
export { FakeModelAdapter } from "./fake-model.js";
export type { FakeModelMode } from "./fake-model.js";
export {
  DISPUTE_LABEL,
  allowanceDisplayName,
  allowanceLabel,
  exhaustedLabel,
  formatAllowanceGap,
  formatMinuteClock,
  formatRetryCountdown,
  healthyCalm,
  healthyVerbose,
  loopLabel,
  normalizePoolState,
  rateLimitLabel,
  retryEscalationLabel,
  stuckLabel,
  waitingRunSlotLabel,
} from "./format.js";
export { combineLoopReadings, measureSteps } from "./loop-patterns.js";
export type { LoopMeasurement } from "./loop-patterns.js";
export { BoardHealthSummaryPill } from "./summary-pill.js";
export { PreloadTelemetryLog, TELEMETRY_HEALTH_TARGET, metricRow } from "./telemetry-log.js";
export {
  ALARM_SIGNAL_KINDS,
  BADGE_TONES,
  COUNTDOWN_TICK_MS,
  HEALTH_BADGE_SLOT_HEIGHT_PX,
  HEALTH_SIGNAL_KINDS,
  MODEL_TIERS,
  PACING_STATES,
  POOL_STATES,
  STUCK_THRESHOLD_MS,
  STEP_KINDS,
  SUPPRESSION_REASONS,
  alarmKindOf,
} from "./types.js";
export type {
  AlarmSignalKind,
  AllowanceReading,
  BackoffReading,
  BadgeTone,
  BoundedExplainerFacts,
  CockpitExplanation,
  ExplanationBullets,
  HealthBoardSnapshot,
  HealthDaemonPort,
  HealthMetricEvent,
  HealthSignal,
  HealthSignalKind,
  HintLadderReading,
  HoldReading,
  InboxWaitReading,
  LoopDetectorReading,
  ModelTier,
  PacingState,
  PoolState,
  ProgressMarks,
  RemediationAction,
  StepKind,
  SuppressionReason,
  TelemetryMetricRow,
  TelemetryMetricWriter,
  TimelineEvent,
  WorkerHealthDetection,
  WorkerHealthTelemetry,
  WorkerStep,
} from "./types.js";
