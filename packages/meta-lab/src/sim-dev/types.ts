/** Meta-Lab simulated developer harness contracts (Task 190). */

export type PersonaStyle =
  | "busy_founder_terse"
  | "rambling_dictation_with_retractions"
  | "non_technical_small_business_owner"
  | "opinionated_senior_engineer"
  | "mid_build_scope_changer";

export type HarnessLifecycleMilestone =
  | "onFeatureMerged"
  | "onTaskStarted"
  | "onInboxCardArrived"
  | "onDiscoveryQuestion"
  | "onPlanPreview"
  | "onApprovalGate";

export type SimDevMode = "scripted" | "persona" | "recorded";

export type CacheMode = "read-write" | "read-only" | "bypass";

export interface HarnessQuestion {
  readonly questionId: string;
  readonly topic: string;
  readonly promptText: string;
}

export interface HarnessInboxCard {
  readonly cardId: string;
  readonly kind: "question" | "approval" | "steering" | "secret";
  readonly title: string;
  readonly body: string;
}

export interface ScriptedReplyRule {
  readonly matchQuestionId?: string;
  readonly matchTopicPattern?: string;
  readonly replyText: string;
  readonly clickAction?: string;
  readonly injectMidBuildSteeringAtTask?: string;
}

export interface ScriptedRuleset {
  readonly id: string;
  readonly strictUnmatched?: boolean;
  readonly safeFallbackReply?: string;
  readonly rules: readonly ScriptedReplyRule[];
}

export interface MidBuildInjection {
  readonly atMilestone: HarnessLifecycleMilestone;
  readonly whenTaskPattern?: string;
  readonly whenFeatureId?: string;
  readonly whenProgressPct?: number;
  readonly message?: string;
  readonly clickAction?: string;
  readonly modifyUnrelatedFile?: string;
}

export interface SimDevTranscriptEntry {
  readonly turnSeq: number;
  readonly triggerEvent: string;
  readonly responseText: string;
  readonly actionTaken: string;
  readonly elapsedMs: number;
  readonly personaTokens: number;
}

export interface SimDevRunResult {
  readonly mode: SimDevMode;
  readonly haltedReason?: string;
  readonly unmatchedQuestions: number;
  readonly transcript: readonly SimDevTranscriptEntry[];
  readonly cacheHitRatio?: number;
}

export interface SimDevDriver {
  readonly mode: SimDevMode;
  driveDiscovery(questions: readonly HarnessQuestion[]): Promise<SimDevRunResult>;
  driveMidBuild(
    injections: readonly MidBuildInjection[],
    context: MidBuildContext,
  ): Promise<SimDevRunResult>;
  exportRecordedSession?(): Promise<AnonymizedRecordedSession>;
}

export interface MidBuildContext {
  readonly featureId: string;
  readonly taskId: string;
  readonly progressPct: number;
  readonly inboxCards: readonly HarnessInboxCard[];
}

export interface RecordedUiAction {
  readonly kind: "click" | "type" | "approve" | "defer";
  readonly target: string;
  readonly value?: string;
}

export interface RecordedTurn {
  readonly seq: number;
  readonly userMessage?: string;
  readonly uiActions: readonly RecordedUiAction[];
}

export interface RecordedSessionFixture {
  readonly sessionId: string;
  readonly turns: readonly RecordedTurn[];
}

export interface AnonymizedRecordedSession {
  readonly sessionId: string;
  readonly turns: readonly RecordedTurn[];
  readonly scrubPasses: number;
}

export interface HiddenSpecPersonaConfig {
  readonly persona: PersonaStyle;
  readonly hiddenSpec: string;
  readonly maxTurns?: number;
  readonly repetitionCeiling?: number;
}

export interface ModelCallInput {
  readonly modelId: string;
  readonly systemPrompt: string;
  readonly messagesJson: string;
  readonly toolsSchemaJson: string;
  readonly temperature: number;
  readonly seed: number;
  readonly responseFormatSchema: string;
}

export interface ModelCallResult {
  readonly content: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly fromCache: boolean;
  readonly costUsd: number;
  readonly latencyMs: number;
}

export interface CacheStats {
  readonly hits: number;
  readonly misses: number;
  readonly bypassed: number;
  readonly hitRatio: number;
}

export interface FakeModelScript {
  readonly match?: { readonly includes?: string };
  readonly response: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export interface FakeModelAdapter {
  complete(input: ModelCallInput): Promise<ModelCallResult>;
  readonly callCount: number;
}