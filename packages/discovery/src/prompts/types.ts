/**
 * Shared types for discovery prompt runners.
 * Schema field names match the closed discovery contracts.
 */

export const PROMPT_IDS = {
  openingReview: "opening-review@1",
  batchResolve: "batch-resolve@1",
  clarify: "clarify@1",
} as const;

export type DiscoveryPromptId = (typeof PROMPT_IDS)[keyof typeof PROMPT_IDS];

export const OPENING_RUBRIC_IDS = [
  "opening.1",
  "opening.2",
  "opening.3",
  "opening.4",
  "opening.5",
] as const;

export type OpeningRubricId = (typeof OPENING_RUBRIC_IDS)[number];

export type CriterionStatus = "settled" | "partial" | "missing" | "conflict";

export type SettledBasis = "explicit" | "derived" | "delegated";

export type ClaimKind = "value" | "recommendation_request" | "delegation";

export type ModelCallRole = "primary" | "format_repair" | "stronger_reviewer";

export interface EvidenceSpan {
  readonly turn: string;
  readonly start: number;
  readonly end: number;
  readonly quote: string;
}

export interface DiscoveryTurn {
  readonly id: string;
  readonly author: "developer" | "harness";
  readonly text: string;
  readonly retracted?: boolean;
  readonly superseded?: boolean;
  readonly retractedSpans?: readonly SpanRange[];
  readonly supersededSpans?: readonly SpanRange[];
}

export interface SpanRange {
  readonly start: number;
  readonly end: number;
}

export interface OptionsVersionBinding {
  readonly turnId: string;
  readonly questionId: string;
  readonly optionsVersionAtInputStart: number;
  readonly replyOptionsVersion: number;
}

export interface RecommendedOption {
  readonly id: string;
  readonly label: string;
}

export interface SchemaIssue {
  readonly path: string;
  readonly message: string;
}

export interface BlockedExit {
  readonly reason: string;
  readonly missingIds: readonly string[];
}

export interface DelegationRecord {
  readonly scope: string;
  readonly limits: readonly string[];
  readonly turn: string;
}

export interface ConflictSide {
  readonly evidence: readonly EvidenceSpan[];
}

export interface BatchProposal {
  readonly criterion: string;
  readonly question: string;
  readonly status: CriterionStatus;
  readonly basis: SettledBasis | null;
  readonly value: string | null;
  readonly evidence: readonly EvidenceSpan[];
  readonly rule: string | null;
  readonly premises: readonly string[];
  readonly delegation: DelegationRecord | null;
  readonly conflict: readonly ConflictSide[] | null;
  readonly missing_detail: string | null;
}

export interface ProposedGap {
  readonly criterion: string;
  readonly source: string;
}

export interface OpeningClaimV1 {
  readonly criterion: string;
  readonly kind: ClaimKind;
  readonly value: string | null;
  readonly evidence: readonly EvidenceSpan[];
}

export interface OpeningRubricV1 {
  readonly rubric: OpeningRubricId;
  readonly covered: readonly string[];
  readonly claims: readonly OpeningClaimV1[];
  readonly smallest_gap: string | null;
}

export interface OpeningDomainV1 {
  readonly pack: string;
  readonly evidence: readonly EvidenceSpan[];
  readonly certain: boolean;
}

export interface OpeningReviewV1 {
  readonly rubrics: readonly OpeningRubricV1[];
  readonly follow_up: { readonly rubric: OpeningRubricId; readonly question: string } | null;
  readonly domains: readonly OpeningDomainV1[];
}

export interface ClarifyOptionV1 {
  readonly id: string;
  readonly label: string;
  readonly recommended?: boolean;
}

export interface ClarifyV1 {
  readonly question_id: string;
  readonly criterion: string;
  readonly text: string;
  readonly options: readonly ClarifyOptionV1[];
  readonly free_text: true;
}

export interface BatchDocumentV1 {
  readonly proposals: readonly BatchProposal[];
  readonly proposed_gaps: readonly ProposedGap[];
  readonly itemIssues: readonly ItemSchemaFailure[];
  readonly gapIssues: readonly SchemaIssue[];
}

export interface ItemSchemaFailure {
  readonly index: number;
  readonly criterion: string | null;
  readonly question: string | null;
  readonly issues: readonly SchemaIssue[];
}

export type QuoteDecisionCode =
  | "accepted"
  | "turn_not_found"
  | "assistant_author"
  | "out_of_bounds"
  | "retracted"
  | "superseded"
  | "quote_mismatch"
  | "digit_altered"
  | "negation_dropped"
  | "currency_altered"
  | "positional_unbound"
  | "stale_options_version"
  | "unknown_criterion"
  | "unknown_question"
  | "recommendation_not_evidence"
  | "uncertainty_not_explicit"
  | "injection_not_evidence"
  | "negation_blocks_value"
  | "broadened_inference"
  | "recipient_not_established"
  | "baseline_is_not_a_requirement";

/** Deterministic accept/reject record for one cited span or claim. */
export interface QuoteValidationResult {
  readonly accepted: boolean;
  readonly code: QuoteDecisionCode;
  readonly message: string;
  readonly turnId: string;
  readonly start: number;
  readonly end: number;
  readonly quote: string;
  readonly criterionId: string | null;
  readonly questionId: string | null;
}

export interface QuoteCheckContext {
  readonly criterionId?: string;
  readonly questionId?: string;
  readonly basis?: SettledBasis | null;
  readonly value?: string | null;
  readonly activeCriteria?: readonly string[];
  readonly activeQuestions?: readonly string[];
  readonly binding?: OptionsVersionBinding | null;
  readonly recommended?: readonly RecommendedOption[];
  readonly repoBaselineValue?: string | null;
}

export interface PromptFailure {
  readonly code: "schema_invalid";
  readonly attempts: number;
  readonly escalated: boolean;
  readonly issues: readonly SchemaIssue[];
}

export interface BatchCriterion {
  readonly id: string;
  readonly questionId: string;
  readonly mustAsk?: boolean;
  readonly costly?: boolean;
  readonly hardToReverse?: boolean;
  readonly kind?: string;
  readonly options?: readonly ClarifyOptionV1[];
  readonly twoReadings?: readonly ReadingOption[];
}

export interface ReadingOption {
  readonly id: string;
  readonly label: string;
}

export interface AllowlistedRule {
  readonly id: string;
  readonly criterionId: string;
  readonly premises: readonly string[];
  readonly allowedValue: string;
  readonly forbidsCriterionIds?: readonly string[];
}

export interface PriorFact {
  readonly id: string;
  readonly status: "settled" | "open" | "partial" | "missing" | "conflict";
  readonly value: string | null;
  readonly criterionId?: string;
}

export interface RepoBaseline {
  readonly criterionId: string;
  readonly observedValue: string;
}

export interface ModelCompletionRequest {
  readonly role: ModelCallRole;
  readonly promptId: DiscoveryPromptId;
  readonly prompt: string;
}

export interface ModelCompletion {
  readonly text: string;
}

export interface ModelProtocolAdapter {
  complete(request: ModelCompletionRequest): Promise<ModelCompletion>;
}

export interface DiscoveryPromptModels {
  readonly primary: ModelProtocolAdapter;
  readonly strongerReviewer: ModelProtocolAdapter;
}

export interface DataBlock {
  readonly source: string;
  readonly text: string;
}

export interface OpeningReviewRequest {
  readonly transcript: string;
  readonly turns: readonly DiscoveryTurn[];
  readonly interactionMode?: string;
  readonly activeCatalog?: readonly string[];
  readonly dataBlocks?: readonly DataBlock[];
}

export interface BatchResolveRequest {
  readonly transcript: string;
  readonly turns: readonly DiscoveryTurn[];
  readonly criteria: readonly BatchCriterion[];
  readonly rules?: readonly AllowlistedRule[];
  readonly priorFacts?: readonly PriorFact[];
  readonly baselines?: readonly RepoBaseline[];
  readonly bindings?: readonly OptionsVersionBinding[];
  readonly dataBlocks?: readonly DataBlock[];
  readonly autoClarify?: boolean;
}

export interface ClarifyRequest {
  readonly questionId: string;
  readonly criterionId: string;
  readonly quotes: readonly string[];
  readonly options: readonly ClarifyOptionV1[];
  readonly recommendation?: RecommendedOption;
  readonly readings?: readonly ReadingOption[];
  readonly situation?: string;
}

export interface SettledDecision {
  readonly criterionId: string;
  readonly questionId: string;
  readonly basis: SettledBasis;
  readonly value: string;
  readonly evidence: readonly EvidenceSpan[];
  readonly rule: string | null;
  readonly premises: readonly string[];
  readonly delegation: DelegationRecord | null;
  readonly plannedChange: boolean;
}

export interface UnsettledDecision {
  readonly criterionId: string;
  readonly questionId: string;
  readonly status: "partial" | "missing" | "conflict";
  readonly missingDetail: string | null;
  readonly evidence: readonly EvidenceSpan[];
  readonly conflict: readonly ConflictSide[] | null;
  readonly delegation: DelegationRecord | null;
}

export interface PendingDecision {
  readonly criterionId: string;
  readonly questionId: string;
  readonly code: string;
  readonly message: string;
}

export type CriterionDisposition =
  | { readonly kind: "settled"; readonly decision: SettledDecision }
  | { readonly kind: "unsettled"; readonly decision: UnsettledDecision }
  | { readonly kind: "pending"; readonly decision: PendingDecision };

export interface ClarifyTrigger {
  readonly questionId: string;
  readonly criterionId: string;
  readonly readings: readonly ReadingOption[];
  readonly quotes: readonly string[];
}

export interface OpeningCredit {
  readonly rubric: OpeningRubricId;
  readonly criterionId: string;
  readonly kind: ClaimKind;
  readonly value: string | null;
  readonly evidence: readonly EvidenceSpan[];
  readonly settled: boolean;
  readonly catalogCriteria: readonly string[];
  readonly partialCatalogCriteria: readonly string[];
}

export interface MappedRubric {
  readonly rubric: OpeningRubricId;
  readonly covered: readonly string[];
  readonly smallestGap: string | null;
  readonly catalogCriteria: readonly string[];
  readonly partialCatalogCriteria: readonly string[];
  readonly credits: readonly OpeningCredit[];
}

export interface DomainFinding {
  readonly pack: string;
  readonly certain: boolean;
  readonly needsScopeProbe: boolean;
  readonly evidence: readonly EvidenceSpan[];
}

export interface OpeningReviewResult {
  readonly promptId: typeof PROMPT_IDS.openingReview;
  readonly ok: boolean;
  readonly failure: PromptFailure | null;
  readonly attempts: number;
  readonly escalated: boolean;
  readonly blocked: BlockedExit | null;
  readonly rubrics: readonly MappedRubric[];
  readonly credits: readonly OpeningCredit[];
  readonly rejectedClaims: readonly QuoteValidationResult[];
  readonly proposedGaps: readonly string[];
  readonly followUp: { readonly rubric: OpeningRubricId; readonly question: string } | null;
  readonly certainDomains: readonly DomainFinding[];
  readonly uncertainDomains: readonly DomainFinding[];
}

export interface ClarifyResult {
  readonly promptId: typeof PROMPT_IDS.clarify;
  readonly ok: boolean;
  readonly failure: PromptFailure | null;
  readonly attempts: number;
  readonly escalated: boolean;
  readonly blocked: BlockedExit | null;
  readonly questionId: string;
  readonly criterionId: string;
  readonly text: string;
  readonly options: readonly ClarifyOptionV1[];
  readonly freeText: true | null;
  readonly decision: {
    readonly status: "open";
    readonly value: null;
    readonly basis: null;
  } | null;
}

export interface BatchResolveResult {
  readonly promptId: typeof PROMPT_IDS.batchResolve;
  readonly ok: boolean;
  readonly failure: PromptFailure | null;
  readonly attempts: number;
  readonly escalated: boolean;
  readonly blocked: BlockedExit | null;
  readonly settled: readonly SettledDecision[];
  readonly unsettled: readonly UnsettledDecision[];
  readonly pending: readonly PendingDecision[];
  readonly proposedGaps: readonly ProposedGap[];
  readonly clarifyRequests: readonly ClarifyTrigger[];
  readonly clarifications: readonly ClarifyResult[];
}
