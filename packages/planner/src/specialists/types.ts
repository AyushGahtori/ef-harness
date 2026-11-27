/**
 * Specialist review and live Q&A types.
 */

export const HIGH_RISK_TOUCHES = [
  "auth",
  "payments",
  "pii",
  "migrations",
  "security",
  "external_side_effect",
  "concurrency",
] as const;

export type HighRiskTouch = (typeof HIGH_RISK_TOUCHES)[number];

/**
 * Closed Task 010 spellings of the same risks. The gate treats them as the
 * spec tags above so a real `authz` or `money` task is still high-risk.
 */
export const HIGH_RISK_TOUCH_ALIASES: Readonly<Record<string, HighRiskTouch>> = {
  authn: "auth",
  authz: "auth",
  session: "auth",
  credentials: "auth",
  money: "payments",
  personal_data: "pii",
  user_content: "pii",
  migration: "migrations",
  external_api: "external_side_effect",
  inbound_webhook: "external_side_effect",
  outbound_message: "external_side_effect",
  concurrent_edit: "concurrency",
};

export const MAX_REVIEWER_REJECTIONS = 2;

/** Task 090 integration/review paperwork share. */
export const INTEGRATION_REVIEW_ENVELOPE_PPM = 40_000;

/** Task 090 warns at 85% of an envelope and compresses optional calls. */
export const BUDGET_PRESSURE_RATIO = 0.85;

export const REVIEWER_ROLE = "reviewer@1" as const;
export const TASTE_ROLE = "taste-reviewer@1" as const;
export const ASK_OWNER_ROLE = "ask-owner-responder@1" as const;

export type SpecialistRole = typeof REVIEWER_ROLE | typeof TASTE_ROLE | typeof ASK_OWNER_ROLE;

export type ReviewerFindingKind = "special_casing" | "weakened_logic" | "missing_rule" | "unsafe";

export type TasteFindingKind = "spacing" | "alignment" | "hierarchy" | "color" | "consistency";

export type TasteSeverity = "low" | "medium" | "high";

export type AskOwnerKind =
  | "answer"
  | "brief_fix"
  | "dispute_upheld"
  | "dispute_rejected"
  | "escalate";

export type ProjectStage = "Prototype" | "MVP" | "Production";

export type CostPreset = "Cheapest" | "Balanced" | "Thorough";

export type ModelLevel = "Junior" | "Mid" | "Senior" | "Manager";

export interface LineRange {
  readonly start: number;
  readonly end: number;
}

export interface ModelRosterEntry {
  readonly family: string;
  readonly vision: boolean;
  readonly level: ModelLevel;
}

export interface FamilyChoice {
  readonly family: string;
  readonly vision: boolean;
  readonly degraded: boolean;
}

export interface MustRequirement {
  readonly id: string;
  readonly text: string;
}

export interface CrossCuttingRule {
  readonly id: string;
  readonly text: string;
}

export interface StaticAuditReceiptView {
  readonly taskId: string;
  readonly passed: boolean;
  readonly fingerprint: string;
  readonly hardFindingCount: number;
  readonly softFindingCount: number;
}

export interface GroundedCitation {
  readonly filePath?: string;
  readonly lineRange?: LineRange;
  readonly nodeId?: string;
  readonly receiptId?: string;
}

export interface CitationGround {
  readonly files: ReadonlyMap<string, ReadonlySet<number>>;
  readonly nodeIds: ReadonlySet<string>;
  readonly receiptIds: ReadonlySet<string>;
}

export interface BlockingFinding {
  readonly kind: ReviewerFindingKind;
  readonly filePath: string;
  readonly lineRange: LineRange;
  readonly violatedRuleOrReqId: string;
  readonly concreteExploitOrFailureScenario: string;
  readonly location: string;
  readonly blocksMerge: true;
}

export interface AdvisoryNote {
  readonly filePath: string;
  readonly lineRange: LineRange | null;
  readonly text: string;
  readonly blocksMerge: false;
}

export interface ReviewerDefectHint {
  readonly taskId: string;
  readonly attemptId: string;
  readonly filePath: string;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly violatedRuleOrReqId: string;
  readonly scenario: string;
  readonly hint: string;
  readonly countsTowardReviewEnvelope: true;
}

export interface HighRiskReviewRequest {
  readonly taskId: string;
  readonly attemptId: string;
  readonly touches: readonly string[];
  readonly hintRetryLevel: number;
  readonly tagDrift: boolean;
  readonly diff: string;
  readonly must: readonly MustRequirement[];
  readonly rules: readonly CrossCuttingRule[];
  readonly staticAudit: StaticAuditReceiptView | null;
  readonly workerFamily: string;
}

export interface ReviewerBase {
  readonly taskId: string;
  readonly tokensSpent: number;
  readonly modelInvoked: boolean;
}

export interface ReviewerSkipped extends ReviewerBase {
  readonly status: "skipped_low_risk";
  readonly blocksMerge: false;
  readonly tokensSpent: 0;
  readonly modelInvoked: false;
}

export interface ReviewerBlocked extends ReviewerBase {
  readonly status: "blocked_merge";
  readonly blocksMerge: true;
  readonly modelInvoked: true;
  readonly rejectionNumber: 1 | 2;
  readonly findings: readonly BlockingFinding[];
  readonly advisory: readonly AdvisoryNote[];
  readonly hint: string;
  readonly family: string;
  readonly familyDegraded: boolean;
  readonly envelopeCharged: true;
}

export interface ReviewerClean extends ReviewerBase {
  readonly status: "clean";
  readonly blocksMerge: false;
  readonly modelInvoked: true;
  readonly findings: readonly BlockingFinding[];
  readonly advisory: readonly AdvisoryNote[];
  readonly family: string;
  readonly familyDegraded: boolean;
}

export interface ReviewerEscalated extends ReviewerBase {
  readonly status: "escalated_to_user";
  readonly blocksMerge: false;
  readonly modelInvoked: true;
  readonly attempt: 3;
  readonly priorRejections: 2;
  readonly diff: string;
  readonly concern: string;
  readonly findings: readonly BlockingFinding[];
  readonly family: string;
  readonly familyDegraded: boolean;
}

export interface ReviewerHeld extends ReviewerBase {
  readonly status: "model_output_invalid" | "model_unavailable" | "model_blocked";
  readonly blocksMerge: false;
  readonly reason: string;
  readonly family: string | null;
}

export type HighRiskReviewResult =
  | ReviewerSkipped
  | ReviewerBlocked
  | ReviewerClean
  | ReviewerEscalated
  | ReviewerHeld;

export type ScreenshotKind = "full_page" | "mobile" | "desktop" | "styleguide";

export type ScreenshotEnvironment = "synthetic_test_env" | "production" | "unknown";

export interface TasteScreenshot {
  readonly id: string;
  readonly screenId: string;
  readonly kind: ScreenshotKind;
  readonly viewportWidth: number;
  readonly bytes: Uint8Array;
  readonly environment: ScreenshotEnvironment;
  readonly seeded: boolean;
  readonly seedReceiptId: string | null;
  readonly sourceFiles: readonly string[];
}

export interface TasteReviewRequest {
  readonly taskId: string;
  readonly stage: ProjectStage;
  readonly preset: CostPreset;
  readonly budgetLimitUnits: number;
  readonly budgetSpentUnits: number;
  readonly screenshots: readonly TasteScreenshot[];
  readonly roster: readonly ModelRosterEntry[];
  readonly workerFamily: string;
  readonly knownFiles: readonly string[];
  readonly knownNodeIds: readonly string[];
  readonly knownReceiptIds: readonly string[];
  readonly repoRoot?: string;
  readonly fileContents?: ReadonlyMap<string, string> | Readonly<Record<string, string>>;
  readonly fileLineCounts?: ReadonlyMap<string, number> | Readonly<Record<string, number>>;
}

export interface TasteFinding {
  readonly screen: string;
  readonly region: string;
  readonly kind: TasteFindingKind;
  readonly severity: TasteSeverity;
  readonly suggestion: string;
  readonly blocksMerge: false;
}

export interface PolishOffer {
  readonly shots: 1;
  readonly requiresUserApproval: true;
  readonly applied: false;
}

export interface LayoutEscalation {
  readonly confidence: "high";
  readonly blocksMerge: false;
  readonly requiresUserApproval: true;
  readonly summary: string;
}

export interface TastePreservedChecks {
  readonly deterministicUiChecks: true;
  readonly reviewerOnSecurityDiffs: true;
}

export interface TasteReviewResult {
  readonly taskId: string;
  readonly label: "ADVISORY ONLY";
  readonly blocksMerge: false;
  readonly tokensSpent: number;
  readonly modelInvoked: boolean;
  readonly preserves: TastePreservedChecks;
  readonly status:
    | "advisory"
    | "skipped_no_vision_model"
    | "skipped_budget_pressure"
    | "skipped_prototype"
    | "skipped_cheapest"
    | "rejected_non_synthetic";
  readonly findings: readonly TasteFinding[];
  readonly polishOffer: PolishOffer | null;
  readonly layoutEscalation: LayoutEscalation | null;
  readonly missingCaptures: readonly string[];
  readonly reason: string | null;
}

export interface DecisionOption {
  readonly id: string;
  readonly label: string;
  readonly recommended: boolean;
}

export interface DecisionCard {
  readonly lines: readonly [string, string, string];
  readonly options: readonly DecisionOption[];
  readonly recommendationId: string;
  readonly requirementQuote: string | null;
  readonly sealedAssertion: string | null;
}

export interface SchemaChange {
  readonly target_id: string;
  readonly text: string;
}

export interface AskOwnerSchemaPayload {
  readonly kind: AskOwnerKind;
  readonly text: string;
  readonly changes: readonly SchemaChange[];
}

export interface ClickableCitation {
  readonly kind: "node" | "file" | "receipt";
  readonly id: string;
  readonly label: string;
  readonly href: string;
}

export interface WorkerEscalationRequest {
  readonly taskId: string;
  readonly question: string;
  readonly logs: string;
  readonly diffSummary: string;
  readonly requirementQuote: string | null;
  readonly sealedAssertion: string | null;
  readonly checkId: string | null;
  readonly requirementId: string | null;
  readonly recordedDecision: { readonly id: string; readonly quote: string } | null;
}

export interface OwnerQuestionRequest {
  readonly question: string;
}

export interface OwnerAnswer {
  readonly schema: AskOwnerSchemaPayload;
  readonly card: DecisionCard | null;
  readonly citations: readonly ClickableCitation[];
  readonly grounded: true;
  readonly guessed: false;
  readonly text: string;
  readonly llmCalls: number;
}

export interface GraphNode {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly text: string;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly status: string;
}

export interface TaskFact {
  readonly taskId: string;
  readonly featureId: string;
  readonly state: string;
}

export interface HoldFact {
  readonly taskId: string;
  readonly reason: string;
  readonly source: string;
}

export interface TableFact {
  readonly table: string;
  readonly ownerNodeId: string;
  readonly title: string;
  readonly text: string;
}

export interface ReceiptFact {
  readonly receiptId: string;
  readonly checkId: string;
  readonly attemptId: string;
  readonly status: string;
  readonly title: string;
}

export interface ModelCall {
  readonly role: SpecialistRole;
  readonly family: string;
  readonly vision: boolean;
  readonly prompt: string;
  readonly imageBytes: number;
}

export interface SpecialistModel {
  complete(call: ModelCall): Promise<unknown>;
}
