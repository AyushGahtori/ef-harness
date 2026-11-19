import type { FeatureDoneConditionId, FeatureState, ProjectState } from "./states.js";

/**
 * Evidence the kernel checks, together with SQL, before `MERGED → DONE`.
 * Conditions 1, 2, and 7 are decided from `state.db`. Conditions 3–6 require
 * this record and still fail when stored checks, path scopes, screen facts,
 * or earlier `DONE` features disagree with it.
 */
export interface FeatureDoneEvidenceInput {
  readonly feature: string;
  readonly staticAudit: {
    readonly clean: boolean;
    readonly integratorCommitsIncluded: boolean;
    readonly paths: readonly string[];
  };
  readonly journey: {
    readonly passed: boolean;
    readonly entryPoint: string;
    readonly cleanEnvironment: boolean;
  };
  readonly integrationMerge: {
    readonly ref: string;
    readonly mergeCommit: string;
    readonly earlierDoneRegressionGreen: boolean;
    readonly regressedFeatureIds: readonly string[];
  };
  readonly accessibility: {
    readonly seriousFindingIds: readonly string[];
  };
}

export interface FeatureDoneCheckResult {
  readonly ok: boolean;
  readonly failedConditions: readonly FeatureDoneConditionId[];
  readonly blockingCcrIds: readonly string[];
  readonly failingRequirements: readonly string[];
}

export interface InitFeatureInput {
  readonly feature: string;
  readonly planAuthor: string;
  readonly rev: number;
  readonly now: number;
  readonly wave?: number | null;
  readonly branch?: string;
}

export interface InitFeatureResult {
  readonly feature: string;
  readonly state: "PLANNED";
  readonly integrationHolder: string;
  readonly epoch: 0;
  readonly branch: string;
  readonly wave: number | null;
  readonly updatedRev: number;
}

export type AdvanceLeavesReason = "advanced" | "no_tasks" | "no_leaves" | "leaves_outstanding" | "not_in_wave";

export interface AdvanceLeavesInput {
  readonly feature: string;
  readonly expectedEpoch: number;
  readonly rev: number;
  readonly now: number;
}

export interface AdvanceLeavesResult {
  readonly ok: boolean;
  readonly feature: string;
  readonly state: FeatureState;
  readonly reason: AdvanceLeavesReason;
  readonly epoch: number;
}

export interface TransitionFeatureInput {
  readonly feature: string;
  readonly to: FeatureState;
  readonly expectedEpoch: number;
  readonly rev: number;
  readonly now: number;
  readonly changeSetId?: string;
  readonly approved?: boolean;
  readonly wave?: number | null;
  readonly evidence?: FeatureDoneEvidenceInput;
}

export interface FeatureTransitionResult {
  readonly feature: string;
  readonly from: FeatureState;
  readonly to: FeatureState;
  readonly epoch: number;
  readonly integrationHolder: string | null;
  readonly updatedRev: number;
  readonly heldDownstream: readonly string[];
}

export interface TransferHolderInput {
  readonly feature: string;
  readonly nextHolder: string;
  readonly expectedEpoch: number;
  readonly rev: number;
  readonly now: number;
}

export interface TransferHolderResult {
  readonly feature: string;
  readonly state: FeatureState;
  readonly previousHolder: string | null;
  readonly integrationHolder: string;
  readonly epoch: number;
  readonly updatedRev: number;
}

export interface TransitionProjectInput {
  readonly to: ProjectState;
  readonly rev: number;
  readonly now: number;
  readonly currentWave?: number | null;
}

export interface ProjectTransitionResult {
  readonly from: ProjectState;
  readonly to: ProjectState;
  readonly currentWave: number | null;
  readonly paused: 0 | 1;
  readonly updatedRev: number;
}

export interface SetProjectPausedInput {
  readonly paused: 0 | 1;
  readonly rev: number;
  readonly now: number;
}

export interface ProjectPauseResult {
  readonly changed: boolean;
  readonly state: ProjectState;
  readonly currentWave: number | null;
  readonly paused: 0 | 1;
  readonly updatedRev: number;
}
