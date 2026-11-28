/**
 * Steering router types for Task 113.
 * Sibling contracts that are not on this base are local ports. See the task handoff.
 */

export const MESSAGE_ORIGINS = [
  "chat_composer",
  "question_card",
  "canvas_box_chat",
  "app_preview_point_to_fix",
  "stop_button",
] as const;

export type MessageOrigin = (typeof MESSAGE_ORIGINS)[number];

export const INTENT_TYPES = [
  "stop_control",
  "read_only_query",
  "answer_question",
  "edit_existing",
  "add_new_feature",
  "undo_feature",
] as const;

export type IntentType = (typeof INTENT_TYPES)[number];

/** Canvas-aligned `router@1` intents from the Task 009 prompt contract. */
export const ROUTER_INTENTS = [
  "question",
  "change",
  "correct_evidence",
  "add",
  "remove",
  "explain_impact",
  "new_feature",
  "control",
] as const;

export type RouterIntent = (typeof ROUTER_INTENTS)[number];

export const CANDIDATE_KINDS = ["feature", "decision", "rule", "question", "task"] as const;

export type CandidateKind = (typeof CANDIDATE_KINDS)[number];

export const CLAUSE_STATUSES = [
  "PENDING",
  "DISPATCHED",
  "DONE",
  "AWAITING_CLARIFICATION",
] as const;

export type ClauseStatus = (typeof CLAUSE_STATUSES)[number];

export const MESSAGE_STATUSES = [
  "QUEUED",
  "ROUTING",
  "EXECUTING",
  "DONE",
  "AWAITING_CLARIFICATION",
] as const;

export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const ROUTER_SHORTLIST_CAP = 15;
export const ROUTER_PROMPT_TOKEN_BUDGET = 1500;
export const FAST_PATH_BUDGET_MS = 2;
export const EMERGENCY_STOP_BUDGET_MS = 10;

/** Safety order: control, answers, edits and removals, additions, queries. */
export const SAFETY_PHASE: Readonly<Record<IntentType, number>> = {
  stop_control: 0,
  answer_question: 1,
  edit_existing: 2,
  undo_feature: 2,
  add_new_feature: 3,
  read_only_query: 4,
};

export interface TextSpan {
  readonly start: number;
  readonly end: number;
}

export interface InputStartFocus {
  readonly activeTab: string;
  readonly selectedCanvasNodeIds: readonly string[];
  readonly openQuestionCardId: string | null;
  readonly openQuestionOptionsVersion: number | null;
  readonly focusedFeatureId: string | null;
  readonly inspectedTaskId: string | null;
  readonly previewSelectedElement?: string;
}

export type ExplicitUiAction =
  | { readonly type: "stop_button" }
  | { readonly type: "pause_button" }
  | { readonly type: "approve_card"; readonly targetId: string }
  | { readonly type: "reject_card"; readonly targetId: string }
  | { readonly type: "box_target"; readonly targetId: string }
  | {
      readonly type: "question_target";
      readonly targetId: string;
      readonly optionsVersion: number;
    };

export interface FocusBinding {
  readonly draftId: string;
  readonly capturedAt: number;
  readonly focus: InputStartFocus;
  readonly liveFocus: InputStartFocus;
  readonly confirmationRequired: boolean;
}

export interface CatalogNodeInput {
  readonly id: string;
  readonly kind: CandidateKind;
  readonly title: string;
  readonly text: string;
  readonly status?: string;
  readonly featureId?: string | null;
  readonly aliases?: readonly string[];
  readonly working?: boolean;
  readonly ownerRole?: string | null;
}

export interface GraphNodeView {
  readonly id: string;
  readonly kind: CandidateKind;
  readonly title: string;
  readonly text: string;
  readonly status: string;
  readonly featureId: string | null;
  readonly aliases: readonly string[];
  readonly working: boolean;
  readonly ownerRole: string | null;
}

export interface FtsHit {
  readonly id: string;
  readonly score: number;
  readonly source: "kb_words" | "kb_ident";
}

export interface ShortlistCard {
  readonly id: string;
  readonly kind: CandidateKind;
  readonly title: string;
  readonly text: string;
  readonly aliases: readonly string[];
  readonly featureId: string | null;
  readonly ownerRole: string | null;
  readonly working: boolean;
  readonly score: number;
  readonly whyMatched: readonly string[];
}

export interface Shortlist {
  readonly cards: readonly ShortlistCard[];
  readonly promptTokens: number;
  readonly ftsWordIds: readonly string[];
  readonly ftsIdentIds: readonly string[];
}

export interface RouterClauseV1 {
  readonly span: TextSpan;
  readonly intent: RouterIntent;
  readonly target_id: string | null;
  readonly confidence: number;
  readonly needs_clarification: boolean;
}

export interface RouterSuccessV1 {
  readonly clauses: readonly RouterClauseV1[];
}

export interface BlockedExitV1 {
  readonly blocked: true;
  readonly reason: string;
  readonly missing_ids?: readonly string[];
}

export type RouterV1 = RouterSuccessV1 | BlockedExitV1;

export interface PlannedClause {
  readonly clauseText: string;
  readonly span: TextSpan;
  readonly intentType: IntentType;
  readonly routerIntent: RouterIntent;
  readonly targetCandidateIds: readonly string[];
  readonly confidence: "high" | "ambiguous";
  readonly alternateReadings: readonly string[];
  readonly needsClarification: boolean;
  readonly routerConfidence: number;
  readonly optionsVersion: number | null;
  readonly dependsOnClauseIds: readonly string[];
  readonly control: "stop" | "pause" | null;
  readonly cardDecision: "approve" | "reject" | null;
}

export interface StoredClause extends PlannedClause {
  readonly messageId: string;
  readonly clauseId: string;
  readonly clauseIndex: number;
  readonly executionIndex: number;
  readonly status: ClauseStatus;
  readonly resultDetail: string | null;
}

export interface ClarificationCard {
  readonly kind: "clarification";
  readonly messageId: string;
  readonly msgSeq: number;
  readonly clauseId: string;
  readonly reason:
    | "ambiguous_readings"
    | "invalid_target"
    | "focus_changed"
    | "unresolved_target"
    | "router_blocked";
  readonly prompt: string;
  readonly alternateReadings: readonly string[];
  readonly pipeline: "Task 115" | "router";
}

export interface MessageReceipt {
  readonly messageId: string;
  readonly msgSeq: number;
  readonly origin: MessageOrigin;
  readonly text: string;
  readonly status: MessageStatus;
  readonly fastPath: boolean;
  readonly routerInvoked: boolean;
  readonly providerCalls: number;
  readonly fastPathMs: number | null;
  readonly inputStartedAt: number | null;
  readonly focus: InputStartFocus | null;
  readonly clauses: readonly StoredClause[];
  readonly clarification: ClarificationCard | null;
}

export interface SubmitMessageInput {
  readonly messageId: string;
  readonly text: string;
  readonly origin: MessageOrigin;
  readonly draftId?: string;
  readonly receivedAt?: number;
  readonly explicitAction?: ExplicitUiAction;
}

export interface RouterRepair {
  readonly attempt: 1;
  readonly errors: readonly string[];
}

export interface RouterPrompt {
  readonly instruction: string;
  readonly messageText: string;
  readonly allowedTargetIds: readonly string[];
  readonly cards: readonly ShortlistCard[];
  readonly focus: InputStartFocus | null;
  readonly previousTargets: readonly string[];
  readonly rendered: string;
  readonly promptTokens: number;
  readonly repair: RouterRepair | null;
}

export interface RecentTurn {
  readonly messageId: string;
  readonly text: string;
  readonly targetIds: readonly string[];
}

export function isBlockedExit(value: RouterV1): value is BlockedExitV1 {
  return "blocked" in value && value.blocked === true;
}

export function isCheckpointStatus(status: MessageStatus): boolean {
  return status === "DONE" || status === "AWAITING_CLARIFICATION";
}

export function assertNever(value: never): never {
  throw new Error(`unexpected value: ${String(value)}`);
}
