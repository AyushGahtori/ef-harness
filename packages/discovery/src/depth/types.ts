/** Project stage presets. The persisted default is `mvp`. */
export const PROJECT_STAGES = ["prototype", "mvp", "production"] as const;
export type ProjectStage = (typeof PROJECT_STAGES)[number];

export const STAGE_LABEL: Readonly<Record<ProjectStage, "Prototype" | "MVP" | "Production">> = {
  prototype: "Prototype",
  mvp: "MVP",
  production: "Production",
};

export const RISK_TIERS = ["low", "medium", "high", "critical"] as const;
export type RiskTier = (typeof RISK_TIERS)[number];

export const REWORK_COSTS = ["easy", "moderate", "hard"] as const;
export type ReworkCost = (typeof REWORK_COSTS)[number];

/** Fixed must-ask classes. Stage, ask_value, and Autopilot cannot remove these. */
export const MUST_ASK_CLASSES = [
  "authentication_roles",
  "payments_side_effects",
  "retention_privacy_pii",
  "core_workflow",
  "deployment_target",
  "user_contradiction",
] as const;
export type MustAskClass = (typeof MUST_ASK_CLASSES)[number];

export const CRITERION_DOMAINS = [
  "general",
  "authentication",
  "payments",
  "sensitive_data",
  "data_model",
  "workflow",
  "deployment",
  "cross_cutting",
] as const;
export type CriterionDomain = (typeof CRITERION_DOMAINS)[number];

export const CRITERION_STATUSES = ["open", "settled", "conflict", "partial", "missing"] as const;
export type CriterionStatus = (typeof CRITERION_STATUSES)[number];

export const SETTLED_BASES = ["explicit", "derived", "delegated", "defaulted", "proposed", "observed"] as const;
export type SettledBasis = (typeof SETTLED_BASES)[number];

export const AUTOMATIC_BASES = ["delegated", "defaulted"] as const;
export type AutomaticBasis = (typeof AUTOMATIC_BASES)[number];

export const HALT_REASONS = [
  "must_ask",
  "conflict",
  "high_risk_spec_expander",
  "ambiguous_brownfield",
  "missing_recommendation",
  "cancelled",
] as const;
export type HaltReason = (typeof HALT_REASONS)[number];

export interface DepthOption {
  readonly id: string;
  readonly label: string;
}

export interface StageRecommendation {
  readonly stage: ProjectStage;
  readonly optionId: string;
  readonly rationale: string;
  /** When true, a prototype question with no prototype rule may use this MVP option. */
  readonly safeForLowerStage: boolean;
}

export interface DepthCatalogEntry {
  readonly criterionId: string;
  readonly label: string;
  readonly riskTier: RiskTier;
  readonly reworkCost: ReworkCost;
  readonly downstreamTaskCount: number;
  readonly options: readonly DepthOption[];
  readonly recommendations: readonly StageRecommendation[];
  readonly stageApplicability: Readonly<Record<ProjectStage, boolean>>;
  readonly strongConventionStages: readonly ProjectStage[];
  readonly evidenceSettled: boolean;
  readonly mustAskClass: MustAskClass | null;
  readonly domain: CriterionDomain;
  readonly deploymentObvious: boolean;
  readonly materialOptionDifference: boolean;
  readonly conflict: boolean;
  readonly highRiskSpecExpander: boolean;
  readonly ambiguousBrownfield: boolean;
  readonly initialStatus?: CriterionStatus;
}

export interface DepthClock {
  now(): number;
}

export interface SupersessionRecord {
  readonly previousBasis: AutomaticBasis;
  readonly previousValue: string;
  readonly previousVersion: number;
}

export interface DepthDecision {
  readonly nodeId: string;
  readonly version: number;
  readonly criterionId: string;
  readonly label: string;
  readonly status: CriterionStatus;
  readonly value: string | null;
  readonly workItemId: string;
  readonly impactLevel: RiskTier;
  readonly downstreamTaskCount: number;
  readonly mustAsk: boolean;
  readonly basis?: SettledBasis;
  readonly rationale?: string;
  readonly recommendedOptionId?: string;
  readonly delegatedAt?: number;
  readonly defaultedAt?: number;
  readonly stageAtDelegation?: ProjectStage;
  readonly decisionBadge?: string;
  readonly mustAskClass?: MustAskClass;
  readonly supersession?: SupersessionRecord;
  readonly askValue?: number;
  readonly impact?: number;
  readonly uncertainty?: number;
  readonly domain?: CriterionDomain;
  readonly conflict?: boolean;
  readonly highRiskSpecExpander?: boolean;
  readonly ambiguousBrownfield?: boolean;
}

export interface AskScore {
  readonly impact: number;
  readonly uncertainty: number;
  readonly importance: number;
  readonly askValue: number;
  readonly askThreshold: number;
  readonly importanceThreshold: number;
}

export type RecommendationResolution =
  | {
      readonly kind: "option";
      readonly optionId: string;
      readonly label: string;
      readonly rationale: string;
      readonly sourceStage: ProjectStage;
      readonly fellBack: boolean;
    }
  | {
      readonly kind: "force_must_ask";
      readonly reason: string;
    };

export interface MustAskAssessment {
  readonly mustAsk: boolean;
  readonly mustAskClass: MustAskClass | null;
  readonly badge: string | null;
  readonly reason: HaltReason | null;
}

export interface VerificationPolicy {
  readonly level: "relaxed" | "standard" | "strict";
  readonly minEvidenceChars: number;
  readonly confirmDerived: boolean;
  /** Lowest risk tier that requires an evidence quote. Null means quotes are not required. */
  readonly evidenceFromRisk: RiskTier | null;
}

export interface StageProfile {
  readonly stage: ProjectStage;
  readonly label: "Prototype" | "MVP" | "Production";
  readonly askThreshold: number;
  readonly importanceThreshold: number;
  readonly impactMultiplier: number;
  readonly visibleQuestionCap: number;
  readonly verification: VerificationPolicy;
}

export interface StageChipModel {
  readonly control: "discover-top-bar-stage-chip";
  readonly stage: ProjectStage;
  readonly label: "Prototype" | "MVP" | "Production";
  readonly choices: readonly { readonly stage: ProjectStage; readonly label: string }[];
  readonly verification: VerificationPolicy;
  readonly askThreshold: number;
  readonly importanceThreshold: number;
  readonly visibleQuestionCap: number;
}

export interface ReconcileResult {
  readonly stage: ProjectStage;
  readonly defaulted: readonly string[];
  readonly reopened: readonly string[];
  readonly heldOpen: readonly string[];
  readonly preservedExplicit: readonly string[];
}

export interface StageSwitchResult extends ReconcileResult {
  readonly changed: boolean;
  readonly banner: string | null;
}

export interface AcceptAllResult {
  readonly delegatedCriterionIds: readonly string[];
  readonly held: readonly { readonly criterionId: string; readonly badge: string }[];
  readonly skippedSettled: readonly string[];
}

export interface AutopilotResult {
  readonly settledCriterionIds: readonly string[];
  readonly halted: boolean;
  readonly haltReason: HaltReason | null;
  readonly haltCriterionId: string | null;
  readonly badge: string | null;
  readonly remainingBlockers: readonly string[];
  readonly reachedReadinessGate: boolean;
  readonly cancelled: boolean;
}

export interface OverrideResult {
  readonly criterionId: string;
  readonly decisionId: string;
  readonly basis: "explicit";
  readonly value: string;
  readonly reopenedDependents: readonly string[];
}

export interface LedgerChangeRoute {
  readonly label: "Change" | "Override";
  readonly route: "revision";
  readonly task: "Task-087";
  readonly decisionId: string;
  readonly criterionId: string;
}

export interface LedgerEntry {
  readonly criterionId: string;
  readonly criterionLabel: string;
  readonly chosenValue: string;
  readonly optionId: string;
  readonly basis: AutomaticBasis;
  readonly rationale: string;
  readonly impactLevel: RiskTier;
  readonly downstreamTaskCount: number;
  readonly decisionId: string;
  readonly change: LedgerChangeRoute;
  readonly override: LedgerChangeRoute;
  readonly planPreview: {
    readonly surface: "plan-preview";
    readonly task: "Task-108";
    readonly visibleBeforeStartBuild: true;
  };
}

export interface LedgerGroup {
  readonly basis: AutomaticBasis;
  readonly entries: readonly LedgerEntry[];
}

export interface LedgerView {
  readonly groups: readonly LedgerGroup[];
  readonly entries: readonly LedgerEntry[];
  readonly planPreviewEntries: readonly LedgerEntry[];
}

export interface GreedyQuestionCandidate {
  readonly id: string;
  readonly criterionIds: readonly string[];
  readonly mustAsk: boolean;
  readonly conflict: boolean;
  readonly downstreamUnblocks: number;
  readonly catalogPriority: number;
}

export function isProjectStage(value: string): value is ProjectStage {
  return (PROJECT_STAGES as readonly string[]).includes(value);
}

export function isAutomaticBasis(value: string): value is AutomaticBasis {
  return value === "delegated" || value === "defaulted";
}

export function isSettledBasis(value: string): value is SettledBasis {
  return (SETTLED_BASES as readonly string[]).includes(value);
}

export function isRiskTier(value: string): value is RiskTier {
  return (RISK_TIERS as readonly string[]).includes(value);
}

export function isCriterionStatus(value: string): value is CriterionStatus {
  return (CRITERION_STATUSES as readonly string[]).includes(value);
}

export function isMustAskClass(value: string): value is MustAskClass {
  return (MUST_ASK_CLASSES as readonly string[]).includes(value);
}

export function systemClock(): DepthClock {
  return { now: () => Date.now() };
}
