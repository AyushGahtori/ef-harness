import { AskOwnerResponderEngine } from "./ask-owner.js";
import { HighRiskDiffReviewer } from "./high-risk-diff-reviewer.js";
import type {
  MemoryReviewRejectionStore,
  ReviewEnvelopePort,
  StaticAuditGate,
  UiPlaywrightContractVerifier,
  VerificationHintLadder,
} from "./ports.js";
import type { SpecialistStateDb } from "./state-db.js";
import { AdvisoryTasteVisionReviewer } from "./taste-reviewer.js";
import type {
  HighRiskReviewRequest,
  HighRiskReviewResult,
  ModelRosterEntry,
  OwnerAnswer,
  OwnerQuestionRequest,
  SpecialistModel,
  TasteReviewRequest,
  TasteReviewResult,
  WorkerEscalationRequest,
} from "./types.js";

export interface SpecialistPromptRunnersOptions {
  readonly db: SpecialistStateDb;
  readonly model: SpecialistModel | null;
  readonly roster: readonly ModelRosterEntry[];
  readonly workerFamily: string;
  readonly rejections?: MemoryReviewRejectionStore;
  readonly hintLadder?: VerificationHintLadder;
  readonly envelope?: ReviewEnvelopePort;
  readonly staticAuditGate?: StaticAuditGate | null;
  readonly verifier?: UiPlaywrightContractVerifier | null;
}

export class SpecialistPromptRunners {
  readonly highRiskDiff: HighRiskDiffReviewer;
  readonly tasteVision: AdvisoryTasteVisionReviewer;
  readonly askOwner: AskOwnerResponderEngine;

  constructor(options: SpecialistPromptRunnersOptions) {
    this.highRiskDiff = new HighRiskDiffReviewer({
      model: options.model,
      roster: options.roster,
      ...(options.rejections !== undefined ? { rejections: options.rejections } : {}),
      ...(options.hintLadder !== undefined ? { hintLadder: options.hintLadder } : {}),
      ...(options.envelope !== undefined ? { envelope: options.envelope } : {}),
      ...(options.staticAuditGate !== undefined ? { staticAuditGate: options.staticAuditGate } : {}),
    });
    this.tasteVision = new AdvisoryTasteVisionReviewer({
      model: options.model,
      ...(options.verifier !== undefined ? { verifier: options.verifier } : {}),
    });
    this.askOwner = new AskOwnerResponderEngine({
      db: options.db,
      model: options.model,
      roster: options.roster,
      workerFamily: options.workerFamily,
    });
  }

  reviewHighRiskDiff(request: HighRiskReviewRequest): Promise<HighRiskReviewResult> {
    return this.highRiskDiff.review(request);
  }

  reviewTaste(request: TasteReviewRequest): Promise<TasteReviewResult> {
    return this.tasteVision.review(request);
  }

  answerOwner(request: string | OwnerQuestionRequest): Promise<OwnerAnswer> {
    return this.askOwner.answerQuestion(request);
  }

  formatWorkerEscalation(request: WorkerEscalationRequest): Promise<OwnerAnswer> {
    return this.askOwner.formatWorkerEscalation(request);
  }

  resolveDisputeChoice(request: WorkerEscalationRequest, optionId: string): Promise<OwnerAnswer> {
    return this.askOwner.resolveDisputeChoice(request, optionId);
  }
}

export { AskOwnerResponderEngine, AskOwnerInputError } from "./ask-owner.js";
export type { AskOwnerResponderEngineOptions } from "./ask-owner.js";
export { checkCitation, filterGrounded } from "./citations.js";
export type { CitationCheck } from "./citations.js";
export { lineRangeInDiff, parseLocation, parseUnifiedDiff } from "./diff.js";
export type { DiffHunk, ParsedDiff } from "./diff.js";
export { FakeModelAdapter, UnscriptedModelError } from "./fake-model.js";
export { AdvisoryTasteVisionReviewer, screenshotRedactionProblem } from "./taste-reviewer.js";
export type { AdvisoryTasteVisionReviewerOptions } from "./taste-reviewer.js";
export { HighRiskDiffReviewer } from "./high-risk-diff-reviewer.js";
export type { HighRiskDiffReviewerOptions } from "./high-risk-diff-reviewer.js";
export { consultModel, estimateTokens, selectFamily } from "./model-select.js";
export {
  MemoryHintLadder,
  MemoryReviewEnvelope,
  MemoryReviewRejectionStore,
  MemoryStaticAuditGate,
  MemoryUiPlaywrightVerifier,
  adaptWorkerLoopModel,
  bindBudgetLedgerReviewEnvelope,
  bindCompletenessGate,
  bindHintLadder,
  bindUiInteractionContractVerifier,
  budgetPressure,
} from "./ports.js";
export type {
  BudgetPressure,
  ReviewEnvelopePort,
  StaticAuditGate,
  UiPlaywrightContractVerifier,
  VerificationHintLadder,
} from "./ports.js";
export { buildAskOwnerPrompt, buildReviewerPrompt, buildTastePrompt } from "./prompts.js";
export { decideReviewerRisk, canonicalHighRiskTouch } from "./risk-gate.js";
export type { RiskGateDecision, RiskGateInput } from "./risk-gate.js";
export {
  isBlockedExit,
  parseAskOwnerResponderV1,
  parseReviewerV1,
  parseTasteReviewerV1,
} from "./schemas.js";
export type {
  AskOwnerResponderV1,
  BlockedExitV1,
  ReviewerFindingV1,
  ReviewerSuccessV1,
  ReviewerV1,
  SchemaParse,
  TasteFindingV1,
  TasteReviewerV1,
  TasteSuccessV1,
} from "./schemas.js";
export { SpecialistStateDb } from "./state-db.js";
export {
  ASK_OWNER_ROLE,
  BUDGET_PRESSURE_RATIO,
  HIGH_RISK_TOUCH_ALIASES,
  HIGH_RISK_TOUCHES,
  INTEGRATION_REVIEW_ENVELOPE_PPM,
  MAX_REVIEWER_REJECTIONS,
  REVIEWER_ROLE,
  TASTE_ROLE,
} from "./types.js";
export type {
  AdvisoryNote,
  AskOwnerKind,
  AskOwnerSchemaPayload,
  BlockingFinding,
  CitationGround,
  ClickableCitation,
  CostPreset,
  CrossCuttingRule,
  DecisionCard,
  DecisionOption,
  FamilyChoice,
  GraphNode,
  GroundedCitation,
  HighRiskReviewRequest,
  HighRiskReviewResult,
  HighRiskTouch,
  HoldFact,
  LayoutEscalation,
  LineRange,
  ModelCall,
  ModelLevel,
  ModelRosterEntry,
  MustRequirement,
  OwnerAnswer,
  OwnerQuestionRequest,
  PolishOffer,
  ProjectStage,
  ReceiptFact,
  ReviewerBase,
  ReviewerBlocked,
  ReviewerClean,
  ReviewerDefectHint,
  ReviewerEscalated,
  ReviewerFindingKind,
  ReviewerHeld,
  ReviewerSkipped,
  SchemaChange,
  ScreenshotEnvironment,
  ScreenshotKind,
  SpecialistModel,
  SpecialistRole,
  StaticAuditReceiptView,
  TableFact,
  TaskFact,
  TasteFinding,
  TasteFindingKind,
  TastePreservedChecks,
  TasteReviewRequest,
  TasteReviewResult,
  TasteScreenshot,
  TasteSeverity,
  WorkerEscalationRequest,
} from "./types.js";
