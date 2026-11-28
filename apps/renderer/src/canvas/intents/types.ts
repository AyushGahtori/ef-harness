export const BOX_CHAT_INTENTS = [
  "ask",
  "correct",
  "change",
  "add",
  "remove_defer",
  "explain_impact",
  "resolve_conflict",
  "approve_edit",
] as const;

export type BoxChatIntent = (typeof BOX_CHAT_INTENTS)[number];

export interface BoxChatSubmission {
  readonly intent: BoxChatIntent;
  readonly nodeIds: readonly string[];
  readonly draft?: string;
  readonly cursor?: number;
  readonly disposition?: RemovalDisposition;
  readonly childKind?: ChildKind;
  readonly offline?: boolean;
  readonly apiBudgetRemaining?: number;
}

export const CORE_BOX_CHAT_INTENTS = [
  "ask",
  "correct",
  "change",
  "add",
  "remove_defer",
  "explain_impact",
] as const;

export type CoreBoxChatIntent = (typeof CORE_BOX_CHAT_INTENTS)[number];

export const CHANGE_CLASSES = ["cosmetic", "clarifying", "compatible", "breaking"] as const;

export type ChangeClass = (typeof CHANGE_CLASSES)[number];

export type ToggleMode = "correct" | "change";

export type DriftChoice = "apply_anyway" | "keep_current" | "edit_again";

export type ChildKind = "requirement" | "field" | "screen" | "feature";

export type RemovalDisposition = "defer" | "deprecate";

export type ProjectStage = "discovery" | "spec" | "plan" | "building" | "merged" | "done";

export interface BoxSignals {
  readonly amberLowConfidence: boolean;
  readonly dictationBadge: boolean;
  readonly freshlyDictated: boolean;
  readonly newlyExtracted: boolean;
  readonly age: "new" | "older";
  readonly basis: string;
  readonly built: boolean;
  readonly landed: boolean;
  readonly lifecycle: ProjectStage;
}

export interface BoxRecord extends BoxSignals {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly text: string;
  readonly value: string;
  readonly status: string;
  readonly version: number;
  readonly provenanceQuote: string;
  readonly codeStatus: string;
  readonly revisionSource: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

export interface SeedNode {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly text?: string;
  readonly value?: string;
  readonly status?: string;
  readonly version?: number;
  readonly basis?: string;
  readonly lifecycle?: ProjectStage;
  readonly built?: boolean;
  readonly landed?: boolean;
  readonly provenanceQuote?: string;
  readonly codeStatus?: string;
  readonly revisionSource?: string;
  readonly amberLowConfidence?: boolean;
  readonly dictationBadge?: boolean;
  readonly freshlyDictated?: boolean;
  readonly newlyExtracted?: boolean;
  readonly age?: "new" | "older";
  readonly fields?: Readonly<Record<string, unknown>>;
}

export interface SeedEdge {
  readonly src: string;
  readonly type: string;
  readonly dst: string;
}

export interface SeedTask {
  readonly id: string;
  readonly state: string;
  readonly title: string;
}

export interface ImpactNode {
  readonly id: string;
  readonly depth: number;
}

export interface ImpactedSubgraph {
  readonly nodes: readonly ImpactNode[];
  readonly affectedDecisions: readonly string[];
  readonly affectedRequirements: readonly string[];
  readonly affectedContracts: readonly string[];
  readonly affectedScreens: readonly string[];
  readonly affectedActiveTasks: readonly string[];
  readonly affectedMergedTasks: readonly string[];
  readonly affectedChecks: readonly string[];
  readonly untouchedTasksCount: number;
  readonly partial: boolean;
  readonly elapsedMs: number;
  readonly canonicalQueries: number;
  readonly cycleSafeQueries: number;
  readonly llmCalls: 0;
  readonly networkCalls: 0;
}

export interface DeltaCostRange {
  readonly lowMicroUsd: number;
  readonly highMicroUsd: number;
  readonly label: string;
}

export interface ImpactPreviewTotals {
  readonly affectedDecisions: readonly string[];
  readonly affectedContracts: readonly string[];
  readonly activeTasksToHold: readonly string[];
  readonly mergedTasksToReverify: readonly string[];
  readonly untouchedTasksCount: number;
  readonly estimatedDeltaCostRange: DeltaCostRange;
  readonly highlightedNodeIds: readonly string[];
  readonly plainEnglish: string;
  readonly changeClass: ChangeClass;
  readonly deltaTasks: number;
  readonly elapsedMs: number;
  readonly llmCalls: 0;
  readonly networkCalls: 0;
  readonly announcement: string;
}

export interface ModelPort {
  readonly calls: number;
  complete(prompt: string): string;
}

export interface NetworkPort {
  readonly calls: number;
  request(path: string): void;
}

export interface ComposerLock {
  readonly nodeId: string;
  readonly baseRevision: number;
  readonly baseValue: string;
  readonly draft: string;
  readonly cursor: number;
  readonly focused: boolean;
}

export interface UndoToast {
  readonly label: "Undo last box edit";
  readonly available: true;
  readonly nodeId: string;
}

export interface MisheardPair {
  readonly heard: string;
  readonly intended: string;
  readonly pair: string;
}

export interface FeatureUndoStep {
  readonly step: 1 | 2 | 3;
  readonly name: "inventory" | "preview" | "confirm_execution";
  readonly executed: boolean;
  readonly detail: string;
}

export interface FeatureUndoLaunch {
  readonly featureId: string;
  readonly title: string;
  readonly deleted: false;
  readonly llmTokens: 0;
  readonly steps: readonly [FeatureUndoStep, FeatureUndoStep, FeatureUndoStep];
  readonly sharedHelpers: readonly string[];
  readonly dormantTables: readonly string[];
  readonly exclusiveFiles: readonly string[];
  readonly dataChoiceDefault: "keep_dormant";
  readonly dataOptions: readonly ["keep_dormant", "drop_in_new_migration"];
  readonly plainEnglish: string;
}

export const APPLY_CHANGE_LABEL = "Apply Change";
export const EDIT_INSTRUCTION_LABEL = "Edit Instruction";
export const CANCEL_PREVIEW_LABEL = "Cancel (0 changes made)";
export const UNDO_TOAST_LABEL = "Undo last box edit" as const;
export const ASK_OWNER_RESPONDER_ID = "ask-owner-responder@1" as const;
export const MICRO_USD_PER_DELTA_TASK = 175_000;
export const DELTA_TASK_CEILING = 5;
export const DELTA_COST_CEILING_MICRO_USD = 1_000_000;
export const IMPACT_MAX_DEPTH = 64;
export const IMPACT_TIME_BUDGET_MS = 15;
