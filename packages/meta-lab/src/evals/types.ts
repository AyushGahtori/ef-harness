export type ArtifactLifecycleState = "draft" | "evaluated" | "active" | "deprecated";

export type EvalLevel = 1 | 2 | 3;

export type PromotionVerdict = "PROMOTE" | "REJECT" | "NEED_MORE_SAMPLES";

export type PromotionExitCode = 0 | 1 | 2;

export interface ConfidenceInterval {
  readonly lower: number;
  readonly upper: number;
  readonly level: number;
}

export interface McNemarResult {
  readonly b: number;
  readonly c: number;
  readonly discordantTotal: number;
  readonly exactPValue: number;
}

export interface BootstrapResult {
  readonly resamples: number;
  readonly seed: string;
  readonly tokenCostSavingsCi: ConfidenceInterval;
  readonly wallClockSavingsCi: ConfidenceInterval;
}

export interface PromotionVetoes {
  readonly redTeamFailures?: number;
  readonly contaminationFlags?: number;
  readonly schemaViolations?: number;
  readonly paperworkPct?: number;
}

export interface PairedPassFailCase {
  readonly caseId: string;
  readonly baselinePass: boolean;
  readonly candidatePass: boolean;
}

export interface PairedContinuousCase extends PairedPassFailCase {
  readonly tokenCostBaseline: number;
  readonly tokenCostCandidate: number;
  readonly wallClockBaseline: number;
  readonly wallClockCandidate: number;
}

export interface PromotionDecisionInput {
  readonly evalRunId: string;
  readonly baselineVersion: string;
  readonly candidateVersion: string;
  readonly cases: readonly PairedContinuousCase[];
  readonly vetoes: PromotionVetoes;
}

export interface PromotionDecision {
  readonly verdict: PromotionVerdict;
  readonly exitCode: PromotionExitCode;
  readonly reason: string;
  readonly mcnemar: McNemarResult;
  readonly bootstrap: BootstrapResult;
  readonly vetoesTriggered: readonly string[];
}

export interface EvalReport {
  readonly evalRunId: string;
  readonly level: EvalLevel;
  readonly baselinePassRate: number;
  readonly candidatePassRate: number;
  readonly promotion?: PromotionDecision;
}

export interface UnitEvalCase {
  readonly caseId: string;
  readonly expectedPass: boolean;
  readonly actualPass: boolean;
}

export interface EvalRunnerOptions {
  readonly candidateId: string;
  readonly level: EvalLevel;
  readonly evalRunId: string;
  readonly suiteDigest: string;
  readonly split: "held_out" | "dev";
}

export interface EvalRunnerResult {
  readonly level: EvalLevel;
  readonly abortedEarly: boolean;
  readonly abortReason?: string;
  readonly baselinePassRate: number;
  readonly candidatePassRate: number;
  readonly report: EvalReport;
}

export interface ArtifactRecord {
  readonly id: string;
  readonly version: string;
  readonly state: ArtifactLifecycleState;
  readonly rollbackPointer?: string;
  readonly evalRunId?: string;
}

export interface LifecycleRegistrySnapshot {
  readonly artifacts: readonly ArtifactRecord[];
}