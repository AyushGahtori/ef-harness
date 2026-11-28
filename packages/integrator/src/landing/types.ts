export const LANDING_PATHS = ["A", "B", "C", "D"] as const;
export type LandingPathId = (typeof LANDING_PATHS)[number];

export const COMMIT_STYLE_CHOICES = [
  "keep_feature_commits",
  "squash_single_commit",
  "create_new_branch",
] as const;
export type CommitStyleChoice = (typeof COMMIT_STYLE_CHOICES)[number];

export const FOUR_OPTION_IDS = [
  "commit_first_then_land",
  "land_separate_branch",
  "side_by_side_diff",
  "cancel",
] as const;
export type FourOptionId = (typeof FOUR_OPTION_IDS)[number];

export type PorcelainKind =
  | "modified"
  | "added"
  | "deleted"
  | "untracked"
  | "ignored"
  | "unmerged"
  | "renamed"
  | "copied"
  | "typechange";

export interface WorkingTreeEntry {
  readonly code: string;
  readonly path: string;
  readonly originalPath: string | null;
  readonly kind: PorcelainKind;
}

export interface PreFlightInput {
  readonly repoPath: string;
  readonly targetBranch: string;
  readonly harnessIntegrationRef?: string;
  readonly featureSlug?: string;
}

export interface PreFlightReport {
  readonly path: LandingPathId;
  readonly targetBranch: string;
  readonly headSha: string;
  readonly harnessIntegrationSha: string;
  readonly mergeBaseSha: string;
  readonly workingTreeClean: boolean;
  readonly dirtyPaths: readonly string[];
  readonly untrackedPaths: readonly string[];
  readonly integrationChangedPaths: readonly string[];
  readonly overlappingPaths: readonly string[];
  readonly mergeTreeConflicts: readonly string[];
  readonly detachedHead: boolean;
  readonly divergedBase: boolean;
  readonly modifyDeleteConflicts: readonly string[];
  readonly untrackedCaseCollisions: readonly string[];
  readonly preview: LandingPreviewCard;
}

export interface LandingPreviewCard {
  readonly commitCount: number;
  readonly changedFileCount: number;
  readonly additions: number;
  readonly deletions: number;
  readonly verificationReceiptSummary: string;
  readonly commitStyleChoices: readonly CommitStyleChoice[];
}

export interface LandingReceipt {
  readonly landingId: string;
  readonly targetBranch: string;
  readonly preLandSha: string;
  readonly landedSha: string;
  readonly safetyRef: string;
  readonly strategy: string;
  readonly overlappingFilesHandled: readonly string[];
  readonly landedAt: string;
}

export interface UndoLandingResult {
  readonly restoredBranchSha: string;
  readonly safetyRef: string;
  readonly undoMessage: string;
}

export interface FourOptionPresentation {
  readonly title: string;
  readonly overlappingPaths: readonly string[];
  readonly options: readonly {
    readonly id: FourOptionId;
    readonly label: string;
    readonly description: string;
  }[];
}

export interface GitRunRecord {
  readonly argv: readonly string[];
  readonly exitCode: number | null;
}