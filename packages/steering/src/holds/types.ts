/**
 * Multi-interpretation hold contracts.
 * Kernel `task_holds` rows stay `(task, reason, source, created_at)`.
 * `reason_type`, `reason_ref_id`, and `mode` live beside that row until
 * Task 021's vocabulary grows. See the task handoff for the swap.
 */

export const HARD_HOLD = "HARD_HOLD" as const;
export const SOFT_HOLD = "SOFT_HOLD" as const;

export type HoldMode = typeof HARD_HOLD | typeof SOFT_HOLD;

/** Nearly finished work (>= 80%) may finish the current step and quarantine. */
export const NEARLY_FINISHED_PROGRESS = 0.8;

/** Unanswered ambiguous holds that block the critical path remind after this. */
export const AMBIGUITY_REMINDER_AFTER_MS = 10 * 60 * 1000;

/** Favorable quarantine release must land without another worker turn, inside this budget. */
export const QUARANTINE_RELEASE_BUDGET_MS = 1_000;

export const UNVERIFIED_DRAFT_LABEL = "Unverified prior draft — verify against new brief";

export const KERNEL_HOLD_REASONS = [
  "user_pause",
  "requirement_change",
  "budget",
  "ccr",
  "governor",
] as const;

export type KernelHoldReason = (typeof KERNEL_HOLD_REASONS)[number];

/** Spec says `VERIFYING`. `CLEAN_VERIFY` is the schema state for that phase. */
export const VERIFYING_STATES = ["VERIFYING", "CLEAN_VERIFY"] as const;

export type ReadingChangeKind = "additive" | "contradictory" | "unspecified";

export type DeltaKind = "none" | "additive" | "contradictory";

export interface WipFile {
  readonly path: string;
  readonly content: string;
}

export interface AlternateReading {
  readonly id: string;
  readonly featureId: string;
  readonly label: string;
  readonly targetNodeIds: readonly string[];
  readonly changeKind: ReadingChangeKind;
  readonly deltaText: string;
  readonly replacementBrief?: string;
  readonly contradictedTokens?: readonly string[];
}

export interface AmbiguousMidBuildMessage {
  readonly messageId: string;
  readonly text: string;
  /** Short subject used in the hold sentence, e.g. `export timestamps`. */
  readonly subject: string;
  readonly alternateReadings: readonly AlternateReading[];
}

export interface TaskSnapshot {
  readonly taskId: string;
  readonly featureId: string;
  readonly label: string;
  readonly progress: number;
  readonly state: string;
  readonly sliceSha256: string;
  readonly briefText: string;
  readonly requirements: readonly string[];
  readonly baseCommit: string;
  readonly sessionRef: string;
  readonly step: number;
  readonly wipFiles: readonly WipFile[];
  readonly criticalPath: boolean;
}

export interface CompiledBrief {
  readonly sliceSha256: string;
  readonly text: string;
  readonly requirements: readonly string[];
  readonly changeKind: DeltaKind;
  readonly deltaNote: string;
  readonly contradictedTokens: readonly string[];
}

export interface SignedSteeringNote {
  readonly text: string;
  readonly signature: string;
  readonly algorithm: "sha256";
}

/** Shape returned by Task 087 `ReverseImpactWalker.walkCombined`. */
export interface ImpactWalkResult {
  readonly affectedActiveTasks: readonly string[];
  readonly affectedContracts: readonly string[];
  readonly partial: boolean;
}

export interface ClassificationInput {
  readonly progress: number;
  readonly state: string;
  readonly impacted: boolean;
  /** Pending change would contradict or destroy the task's current work. */
  readonly destructive: boolean;
}

export type HoldModeDecision =
  | { readonly action: "continue" }
  | { readonly action: typeof HARD_HOLD; readonly quarantine: false }
  | { readonly action: typeof SOFT_HOLD; readonly quarantine: true };

export interface ClarificationOption {
  readonly readingId: string;
  readonly featureId: string;
  readonly label: string;
}

export interface ClarificationCard {
  readonly messageId: string;
  readonly question: string;
  readonly subject: string;
  readonly options: readonly ClarificationOption[];
  readonly affectedTaskIds: readonly string[];
  readonly cardCount: 1;
}

export interface ReminderPill {
  readonly messageId: string;
  readonly tone: "calm";
  readonly text: string;
  readonly autoGuessed: false;
  readonly blockedCriticalTaskIds: readonly string[];
}

export interface HoldVisibilityEntry {
  readonly taskId: string;
  readonly featureId: string;
  readonly holdKey: string;
  readonly reasonType: string;
  readonly reasonRefId: string;
  readonly mode: HoldMode;
  readonly explanation: string;
  readonly board: true;
  readonly inspector: true;
}

export interface HoldPlacement {
  readonly taskId: string;
  readonly featureId: string;
  readonly mode: HoldMode;
  readonly quarantine: boolean;
  readonly holdKey: string;
  readonly explanation: string;
}

export interface HoldPlacementResult {
  readonly messageId: string;
  readonly affectedTaskIds: readonly string[];
  readonly untouchedTaskIds: readonly string[];
  readonly placements: readonly HoldPlacement[];
  readonly card: ClarificationCard;
  readonly walkerCalls: number;
  readonly transaction: readonly string[];
}

export interface ActiveHold {
  readonly taskId: string;
  readonly featureId: string;
  readonly holdKey: string;
  readonly reasonType: string;
  readonly reasonRefId: string;
  readonly kernelReason: KernelHoldReason;
  readonly source: string;
  readonly mode: HoldMode;
  readonly quarantine: boolean;
  readonly explanation: string;
  readonly messageId: string;
  readonly createdAt: number;
}

export interface CheckpointView {
  readonly taskId: string;
  readonly featureId: string;
  readonly label: string;
  readonly progress: number;
  readonly state: string;
  readonly sliceSha256: string;
  readonly briefText: string;
  readonly requirements: readonly string[];
  readonly baseCommit: string;
  readonly sessionRef: string;
  readonly step: number;
  readonly wipFiles: readonly WipFile[];
  readonly criticalPath: boolean;
}

export interface QuarantinedCandidate {
  readonly taskId: string;
  readonly commitSha: string;
  readonly baseCommit: string;
  readonly attempt: string;
  readonly receivedAt: number;
  readonly status: "submission_pending" | "discarded" | "landed" | "reverify_failed";
}

export type QuarantineDisposition = "none" | "landed" | "reverified" | "blocked_drift" | "discarded";

export type SessionDisposition = "unchanged" | "warm_note" | "fresh" | "still_held";

export interface TaskResolution {
  readonly taskId: string;
  readonly holdCount: number;
  readonly delta: DeltaKind | "blocked";
  readonly session: SessionDisposition;
  readonly quarantine: QuarantineDisposition;
  readonly elapsedMs: number | null;
  readonly landedCommitSha: string | null;
  readonly sessionRef: string;
  readonly steeringNote: SignedSteeringNote | null;
  readonly salvagedWip: readonly { readonly path: string; readonly label: string }[];
  readonly discardedWip: readonly string[];
  readonly workerModelTurn: false;
}

export interface ResolutionResult {
  readonly messageId: string;
  readonly selectedReadingIds: readonly string[];
  readonly tasks: readonly TaskResolution[];
  readonly transaction: readonly string[];
}

export interface QuarantineFinish {
  readonly commitSha: string;
  readonly baseCommit: string;
  readonly attempt: string;
}

export interface MergeDecision {
  readonly taskId: string;
  readonly allowed: boolean;
  readonly reason: "clear" | "held" | "quarantine";
}

export class HoldEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HoldEngineError";
  }
}
