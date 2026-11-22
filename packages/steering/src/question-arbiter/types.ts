import type {
  HumanReason,
  PriorityTier,
  QuestionKind,
  QuestionStatus,
  SettledSource,
} from "./constants.js";

export interface PrioritySignals {
  readonly stop: boolean;
  readonly security: boolean;
  readonly authExpiry: boolean;
  readonly budgetCap: boolean;
  readonly criticalBlocker: boolean;
}

export interface QuestionOption {
  readonly number: number;
  readonly id: string;
  readonly label: string;
}

export interface QuestionSubscriber {
  readonly waitingTaskId: string;
  readonly waitingRole: string;
  readonly active: boolean;
  readonly createdAt: number;
}

export interface QuestionCard {
  readonly questionId: string;
  readonly buildId: string;
  readonly questionKey: string;
  readonly scopeId: string | null;
  readonly criterionId: string | null;
  readonly featureId: string | null;
  readonly contractId: string | null;
  readonly kind: QuestionKind;
  readonly humanReason: HumanReason;
  readonly text: string;
  readonly ownerRole: string;
  readonly priority: PriorityTier;
  readonly priorityRank: number;
  readonly status: QuestionStatus;
  readonly optionsVersion: number;
  readonly options: readonly QuestionOption[];
  readonly recommendedOptionId: string;
  readonly whyThisMatters: string;
  readonly blockingLabel: string;
  readonly blockedWorkerCount: number;
  readonly subscribers: readonly QuestionSubscriber[];
  readonly createdAt: number;
  readonly resolvedAt: number | null;
  readonly retiredReason: string | null;
  readonly settledAnswer: string | null;
  readonly settledOptionId: string | null;
  readonly settledBy: string | null;
  readonly signals: PrioritySignals;
  readonly onCriticalPath: boolean;
}

export interface WorkerQuestionRequest {
  readonly buildId: string;
  readonly workerId: string;
  readonly waitingTaskId: string;
  readonly waitingRole: string;
  readonly text: string;
  readonly kind: QuestionKind;
  readonly scopeId?: string;
  readonly criterionId?: string;
  readonly contractId?: string;
  readonly featureId?: string;
  readonly questionId?: string;
  readonly options?: readonly string[];
  readonly recommendedOptionId?: string;
  readonly onCriticalPath?: boolean;
  readonly signals?: Partial<PrioritySignals>;
}

export interface QuestionReply {
  readonly optionsVersion: number;
  readonly optionId?: string;
  readonly text?: string;
}

export interface SettledFact {
  readonly factId: string;
  readonly scopeId: string | null;
  readonly criterionId: string | null;
  readonly topicKey: string;
  readonly normalizedText: string;
  readonly answer: string;
  readonly source: SettledSource;
  readonly tableName: string | null;
  readonly columnName: string | null;
}

export interface SettledFactDraft {
  readonly text: string;
  readonly answer: string;
  readonly source: SettledSource;
  readonly scopeId?: string;
  readonly criterionId?: string;
  readonly topicKey?: string;
  readonly tableName?: string;
  readonly columnName?: string;
}

export interface HoldReason {
  readonly taskId: string;
  readonly reasonType: string;
  readonly reasonRefId: string;
  readonly mode: "HARD_HOLD" | "SOFT_HOLD";
  readonly active: boolean;
}

export interface WakeRecord {
  readonly wakeId: string;
  readonly questionId: string;
  readonly waitingTaskId: string;
  readonly answer: string;
  readonly createdAt: number;
}

export interface PendingReply {
  readonly pendingId: string;
  readonly questionId: string;
  readonly optionsVersion: number;
  readonly optionId: string | null;
  readonly replyText: string;
  readonly createdAt: number;
  readonly disposition: "pending" | "kept" | "changed";
}

export interface OutboxEventRecord {
  readonly id: string;
  readonly type: string;
  readonly subject: string | null;
  readonly payload: string;
  readonly createdAt: number;
}

export interface InboxProjection {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly priority: number;
  readonly payload: string;
  readonly subscribers: readonly { readonly item: string; readonly task: string }[];
}

export type JsonValue = null | string | number | boolean | JsonValue[] | { readonly [key: string]: JsonValue };

export interface FilterAutoReply {
  readonly lane: "auto_reply";
  readonly userInterrupted: false;
  readonly answer: string;
  readonly source: SettledSource;
  readonly factId: string;
  readonly elapsedMs: number;
}

export interface FilterOwnerRoute {
  readonly lane: "owner_mailbox";
  readonly userInterrupted: false;
  readonly mailboxId: string;
  readonly targetRole: string;
  readonly targetOwnerTaskId: string;
  readonly elapsedMs: number;
}

export interface FilterHumanQueue {
  readonly lane: "human_queue";
  readonly userInterrupted: boolean;
  readonly reason: HumanReason;
  readonly card: QuestionCard;
  readonly collapsed: boolean;
  readonly elapsedMs: number;
}

export type FilterDisposition = FilterAutoReply | FilterOwnerRoute | FilterHumanQueue;

export interface AdmitResult {
  readonly card: QuestionCard;
  readonly created: boolean;
  readonly newSubscriber: boolean;
}

export interface AppliedAnswer {
  readonly outcome: "applied";
  readonly mutated: true;
  readonly card: QuestionCard;
  readonly wokenTaskIds: readonly string[];
}

export interface AlreadySavedAnswer {
  readonly outcome: "already_saved";
  readonly mutated: false;
  readonly message: "Already saved via your edit — nothing changed";
  readonly card: QuestionCard;
}

export interface ChoiceNeededAnswer {
  readonly outcome: "needs_choice";
  readonly mutated: false;
  readonly prompt: string;
  readonly headline: string;
  readonly pendingReplyId: string;
  readonly settledBy: string;
  readonly retainedReply: string;
  readonly card: QuestionCard;
  readonly choices: readonly ["keep", "change"];
}

export type AnswerResult = AppliedAnswer | AlreadySavedAnswer | ChoiceNeededAnswer;

export interface KeptChoice {
  readonly outcome: "kept";
  readonly mutated: false;
  readonly card: QuestionCard;
  readonly message: string;
}

export interface ChangedChoice {
  readonly outcome: "changed";
  readonly mutated: true;
  readonly card: QuestionCard;
  readonly wokenTaskIds: readonly string[];
}

export type ChoiceResult = KeptChoice | ChangedChoice;

export interface DeliveryAssessment {
  readonly questionId: string;
  readonly priority: PriorityTier;
  readonly lane: "interrupt_now" | "batch" | "digest";
  readonly due: boolean;
  readonly earlyFlush: boolean;
  readonly agingNudge: boolean;
  readonly waitedMs: number;
  readonly surfaced: boolean;
  readonly sound: false;
  readonly modal: false;
}

export interface InterruptionTotals {
  readonly buildId: string;
  readonly intercepted: number;
  readonly duplicatesCollapsed: number;
  readonly humanInterruptions: number;
}

export interface OwnerRef {
  readonly ownerRole: string;
  readonly ownerTaskId: string;
}

export interface OwnerMailboxSubmit {
  readonly kind: "ContractClarificationRequest";
  readonly targetRole: string;
  readonly targetOwnerTaskId: string;
  readonly contractId: string;
  readonly requestingTaskId: string;
  readonly payload: {
    readonly requestingTaskId: string;
    readonly contractId: string;
    readonly question: string;
  };
}

export interface OwnerMailboxReceipt {
  readonly mailboxId: string;
  readonly targetRole: string;
  readonly targetOwnerTaskId: string;
  readonly deduped: boolean;
}
