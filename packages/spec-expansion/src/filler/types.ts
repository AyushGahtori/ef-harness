/** Domain types for the ordered spec-cell filler. */

export const RISK_TIERS = ["low", "medium", "high"] as const;
export type RiskTier = (typeof RISK_TIERS)[number];

export const SETTLED_BASES = ["explicit", "derived", "delegated"] as const;
export type SettledBasis = (typeof SETTLED_BASES)[number];

export const FILL_BASES = ["explicit", "derived", "delegated", "defaulted", "proposed"] as const;
export type FillBasis = (typeof FILL_BASES)[number];

export const MATRIX_IDS = [
  "M01",
  "M02",
  "M03",
  "M04",
  "M05",
  "M06",
  "M07",
  "M08",
  "M09",
  "M10",
  "M11",
  "M12",
] as const;
export type MatrixId = (typeof MATRIX_IDS)[number] | (string & {});

export const PASS3_BATCH_LIMIT = 25;

export interface OpenCell {
  readonly id: string;
  readonly featureId: string;
  readonly matrixId: string;
  readonly subject: string;
  readonly title: string;
  readonly touches: readonly string[];
  readonly applicability?: "active" | "not_applicable";
  readonly notApplicableReason?: string;
}

export interface DecisionEntailment {
  readonly cellId?: string;
  readonly cellPattern?: string;
  readonly value: string;
  readonly earsText: string;
  readonly oracleSketch: string;
}

export interface SettledDecision {
  readonly id: string;
  readonly basis: SettledBasis;
  readonly title: string;
  readonly text: string;
  readonly contentHash: string;
  readonly entails: readonly DecisionEntailment[];
}

export interface CrossCuttingRule {
  readonly id: string;
  readonly text: string;
  readonly any: readonly string[];
  readonly all: readonly string[];
  readonly cellPatterns: readonly string[];
  readonly earsText: string;
  readonly oracleSketch: string;
}

export interface OptionElaboration {
  readonly id: string;
  readonly questionId: string;
  readonly optionId: string;
  readonly cellPattern: string;
  readonly value: string;
  readonly earsText: string;
  readonly oracleSketch: string;
}

export interface UniversalPolicyClause {
  readonly id: string;
  readonly source: "v1-corpus" | "task-076";
  readonly statement: string;
  readonly cellPatterns: readonly string[];
  readonly any: readonly string[];
  readonly all: readonly string[];
  readonly earsText: string;
  readonly oracleSketch: string;
}

export interface ChosenOption {
  readonly questionId: string;
  readonly optionId: string;
}

export interface PersistedFill {
  readonly cellId: string;
  readonly pass: 1 | 2 | 3;
  readonly basis: FillBasis;
  readonly risk: RiskTier;
  readonly value: string;
  readonly earsText: string;
  readonly oracleSketch: string;
  readonly sourceIds: readonly string[];
  readonly sourceHash: string;
  readonly upstreamDecisionHash: string;
  readonly requirementId: string | null;
  readonly reviewStatus: "settled" | "auto_accepted" | "proposed" | "rejected" | "needs_review" | "must_ask";
}

export interface MatrixCellDraft extends OpenCell {
  readonly fill: PersistedFill | null;
}

export interface ModelRequest {
  readonly attempt: string;
  readonly step: number;
  readonly prompt: string;
}

export interface ModelCompletion {
  readonly text: string;
  readonly actualTokens: number;
}

/** Local stand-in for Task 034 `FakeModelAdapter` until that package is on the barrel. */
export interface SpecExpanderModel {
  complete(request: ModelRequest): ModelCompletion;
}

export interface SpecExpanderCell {
  readonly cell_id: string;
  readonly value: string | null;
  readonly basis: "proposed" | null;
  readonly status: "asked" | null;
  readonly ears_text: string;
  readonly oracle_sketch: string;
  readonly risk: RiskTier;
  readonly premises: readonly string[];
}

export interface MustAskQuestion {
  readonly cellId: string;
  readonly featureId: string;
  readonly nodeId: string;
  readonly question: string;
  readonly touches: readonly string[];
  readonly blocking: true;
  readonly target: "discovery";
  readonly forcedHigh: boolean;
  readonly modelRisk: RiskTier;
}

export interface FillDiagnostic {
  readonly code:
    | "budget_exceeded"
    | "vague_after_repair"
    | "omitted_cell"
    | "scope_invention"
    | "pass3_blocked"
    | "conflict_with_pass1"
    | "malformed_output"
    | "duplicate_requirement";
  readonly cellId?: string;
  readonly message: string;
}

export interface FillMetrics {
  readonly activeCells: number;
  readonly pass1Count: number;
  readonly pass2Count: number;
  readonly pass3Count: number;
  readonly lines: readonly string[];
  readonly pass1Share: number;
  readonly pass2Share: number;
  readonly deterministicShare: number;
  readonly tokensSpent: number;
  readonly deterministicTokens: 0;
  readonly llmCalls: number;
}

export interface CellOutcome {
  readonly cellId: string;
  readonly featureId: string;
  readonly matrixId: string;
  readonly disposition: "filled" | "escalated" | "needs_review" | "not_applicable";
  readonly pass: 1 | 2 | 3 | null;
  readonly basis: FillBasis | null;
  readonly risk: RiskTier | null;
  readonly earsText: string | null;
  readonly oracleSketch: string | null;
  readonly value: string | null;
  readonly sourceIds: readonly string[];
  readonly sourceHash: string | null;
  readonly requirementId: string | null;
  readonly unchanged: boolean;
}

export interface ContradictionPair {
  readonly leftId: string;
  readonly rightId: string;
  readonly leftText: string;
  readonly rightText: string;
}

export interface ContradictionRecheckInput {
  readonly reason: "pass3_conflict" | "review_edit" | "review_approve";
  readonly requirementIds: readonly string[];
  readonly pairs: readonly ContradictionPair[];
}

export interface ContradictionRecheckResult {
  readonly flagged: number;
}

/** Local port for Task 081 until `FiveLayerContradictionEngine` is on this base. */
export interface ContradictionRecheckPort {
  recheck(input: ContradictionRecheckInput): ContradictionRecheckResult;
}

export interface ChosenForYouEntry {
  readonly cellId: string;
  readonly featureId: string;
  readonly basis: "proposed";
  readonly risk: "low";
  readonly earsText: string;
  readonly oracleSketch: string;
  readonly autoAccepted: true;
  readonly requirementId: string;
}

export interface ChosenForYouPort {
  record(entry: ChosenForYouEntry): void;
  list(): readonly ChosenForYouEntry[];
}

export interface FeatureBudget {
  readonly maxCallsPerFeature: number;
  readonly maxTokensPerFeature: number;
}

export interface ReadinessSnapshot {
  readonly pendingMedium: number;
  readonly blockingMustAsk: number;
  readonly settledRequirements: number;
  readonly rejected: number;
}

export interface ClarificationPrompt {
  readonly cellId: string;
  readonly featureId: string;
  readonly nodeId: string;
  readonly prompt: string;
  readonly reason: "rejected_proposal";
}
