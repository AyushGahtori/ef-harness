export const PACK_MANIFEST_SCHEMA_VERSION = 1 as const;

export const PROJECT_STAGES = ["prototype", "mvp", "production"] as const;

export type ProjectStage = (typeof PROJECT_STAGES)[number];

export const IMPACT_CLASSES = ["low", "medium", "high", "critical"] as const;

export type ImpactClass = (typeof IMPACT_CLASSES)[number];

export const REVERSIBILITY_VALUES = ["easy", "costly", "irreversible"] as const;

export type Reversibility = (typeof REVERSIBILITY_VALUES)[number];

export const QUESTION_SCOPES = ["shared", "project"] as const;

export type QuestionScope = (typeof QUESTION_SCOPES)[number];

export const QUESTION_STATUSES = ["draft", "evaluated", "active", "deprecated"] as const;

export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

export const CORPUS_DOCUMENT_KINDS = [
  "question_pack",
  "option_elaborations",
  "universal_policies",
  "cross_cutting_rules",
  "seam_templates",
] as const;

export type CorpusDocumentKind = (typeof CORPUS_DOCUMENT_KINDS)[number];

export interface AppliesWhenClause {
  readonly criterion: string;
  readonly equals?: string;
}

export interface OptionManifest {
  readonly id: string;
  readonly label: string;
  readonly meaning: string;
  readonly stage_suitability: readonly ProjectStage[];
  readonly consequences: string;
}

export interface StageRecommendationManifest {
  readonly option: string;
  readonly rationale: string;
}

export interface PositiveExampleManifest {
  readonly utterance: string;
  readonly style?: "spoken_dictation" | "plain";
  readonly settles: Readonly<Record<string, string>>;
}

export interface NegativeExampleManifest {
  readonly utterance: string;
  readonly must_not_settle: readonly string[];
  readonly reason: string;
}

export interface QuestionEvalManifest {
  readonly asked: number;
  readonly changed_build_decision: number;
  readonly user_marked_unhelpful: number;
}

export interface QuestionManifest {
  readonly id: string;
  readonly version: number;
  readonly scope: QuestionScope;
  readonly domains: readonly string[];
  readonly title: string;
  readonly explain: string;
  readonly criteria: readonly string[];
  readonly applies_when: readonly AppliesWhenClause[];
  readonly requires: readonly string[];
  readonly conflicts_with: readonly string[];
  readonly risk_tier: ImpactClass;
  readonly impact: ImpactClass;
  readonly reversibility: Reversibility;
  readonly must_ask: boolean;
  readonly touches: readonly string[];
  readonly options: readonly OptionManifest[];
  readonly stage_recommendations: Readonly<Record<ProjectStage, StageRecommendationManifest>>;
  readonly allowed_inference_rules: readonly string[];
  readonly invalidates_on_change: readonly string[];
  readonly positive_examples: readonly PositiveExampleManifest[];
  readonly negative_examples: readonly NegativeExampleManifest[];
  readonly stage_applicability: Readonly<Record<ProjectStage, boolean>>;
  readonly status: QuestionStatus;
  readonly eval: QuestionEvalManifest;
  readonly renamed_from?: string;
}

export interface LoadedQuestion extends QuestionManifest {
  readonly source_file: string;
}

export interface QuestionPackManifest {
  readonly kind: "question_pack";
  readonly id: string;
  readonly version: number;
  readonly title: string;
  readonly questions: readonly QuestionManifest[];
}

export interface ElaborationCellManifest {
  readonly cell: string;
  readonly value: string;
}

export interface OptionElaborationManifest {
  readonly id: string;
  readonly question: string;
  readonly option: string;
  readonly cells: readonly ElaborationCellManifest[];
  readonly edge_cases: readonly string[];
  readonly bounds: readonly string[];
  readonly oracle_hints: readonly string[];
  readonly source_file: string;
}

export interface OptionElaborationPackManifest {
  readonly kind: "option_elaborations";
  readonly id: string;
  readonly version: number;
  readonly title?: string;
  readonly elaborations: readonly OptionElaborationManifest[];
}

export interface UniversalPolicyManifest {
  readonly id: string;
  readonly cell: string;
  readonly value: string;
  readonly source_file: string;
}

export interface UniversalPolicyPackManifest {
  readonly kind: "universal_policies";
  readonly id: string;
  readonly version: number;
  readonly title?: string;
  readonly policies: readonly UniversalPolicyManifest[];
}

export interface RuleScopeManifest {
  readonly any?: readonly string[];
  readonly all?: readonly string[];
}

export interface CrossCuttingRuleManifest {
  readonly id: string;
  readonly rule: string;
  readonly scope: RuleScopeManifest;
  readonly check_kind: string;
  readonly source_file: string;
}

export interface CrossCuttingRulePackManifest {
  readonly kind: "cross_cutting_rules";
  readonly id: string;
  readonly version: number;
  readonly title?: string;
  readonly rules: readonly CrossCuttingRuleManifest[];
}

export interface SeamTemplateManifest {
  readonly id: string;
  readonly title: string;
  readonly activates_when: readonly string[];
  readonly contract_template: string;
  readonly edge_cases: readonly string[];
  readonly rules_activated: readonly string[];
  readonly source_file: string;
}

export interface SeamTemplatePackManifest {
  readonly kind: "seam_templates";
  readonly id: string;
  readonly version: number;
  readonly title?: string;
  readonly seams: readonly SeamTemplateManifest[];
}

export interface ParsedCorpusFile {
  readonly path: string;
  readonly kind: CorpusDocumentKind;
  readonly document: unknown;
}

export interface ConflictAsymmetry {
  readonly leftId: string;
  readonly leftFile: string;
  readonly rightId: string;
  readonly rightFile: string;
}

export interface CorpusBundle {
  readonly corpusRoot: string;
  readonly formatVersion: typeof PACK_MANIFEST_SCHEMA_VERSION;
  readonly files: readonly ParsedCorpusFile[];
  readonly questions: readonly LoadedQuestion[];
  readonly elaborations: readonly OptionElaborationManifest[];
  readonly policies: readonly UniversalPolicyManifest[];
  readonly rules: readonly CrossCuttingRuleManifest[];
  readonly seams: readonly SeamTemplateManifest[];
  readonly corpusBundleHash: string;
  readonly conflictAsymmetries: readonly ConflictAsymmetry[];
}

export interface SettledDecisionSnapshot {
  readonly decisionId: string;
  readonly questionId: string;
  readonly criterion: string;
  readonly value: string;
  readonly basis: string;
}

export interface ScopeCriterionSnapshot {
  readonly workItem: string;
  readonly scopeRev: number;
  readonly decision: string;
  readonly neededForPlanning: number;
  readonly critical: number;
}

export interface ProjectMetadataPort {
  getMeta(key: string): string | null;
  setMeta(key: string, value: string): void;
}

/**
 * Local port standing in for Task 017 KnowledgeGraphRepo plus the state.db
 * meta table. The published KnowledgeGraphRepo methods do not write meta.
 * This port reads settled decision nodes and scope_criteria without writing them.
 */
export interface CorpusProjectStatePort extends ProjectMetadataPort {
  listSettledDecisions(): readonly SettledDecisionSnapshot[];
  listScopeCriteria(): readonly ScopeCriterionSnapshot[];
}

export interface QuestionCatalogEntry {
  readonly id: string;
  readonly title: string;
  readonly version: number;
  readonly criteria: readonly string[];
  readonly renamedFrom: string | null;
}

export interface CorpusReconciliationEntry {
  readonly pinnedHash: string;
  readonly observedHash: string;
  readonly addedQuestionIds: readonly string[];
  readonly removedQuestionIds: readonly string[];
  readonly renamed: readonly { readonly from: string; readonly to: string }[];
}

export interface ReconciliationResult {
  readonly pinnedHash: string;
  readonly incomingHash: string;
  readonly initialPin: boolean;
  readonly upgraded: boolean;
  readonly addedQuestionIds: readonly string[];
  readonly removedQuestionIds: readonly string[];
  readonly renamed: readonly { readonly from: string; readonly to: string }[];
  readonly settledDecisions: readonly SettledDecisionSnapshot[];
  readonly scopeCriteria: readonly ScopeCriterionSnapshot[];
}
