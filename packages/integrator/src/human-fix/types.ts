import type {
  HUMAN_ENTRY_CARD,
  HUMAN_ENTRY_CHAT,
  HUMAN_ENTRY_COMMIT,
  WORKSPACE_MAIN_CHECKOUT,
  WORKSPACE_TASK_WORKTREE,
} from "./constants.js";

export type HumanFixEntryKind =
  | typeof HUMAN_ENTRY_CARD
  | typeof HUMAN_ENTRY_CHAT
  | typeof HUMAN_ENTRY_COMMIT;

export type WorkspaceChoice =
  | typeof WORKSPACE_TASK_WORKTREE
  | typeof WORKSPACE_MAIN_CHECKOUT;

export type TaskState =
  | "DRAFTED"
  | "READY"
  | "LEASED"
  | "CODING"
  | "STATIC_AUDIT"
  | "CLEAN_VERIFY"
  | "ACCEPTED"
  | "MERGED_TO_FEATURE"
  | "WAITING_INPUT"
  | "PARKED"
  | "ESCALATED"
  | "EXHAUSTED"
  | "HUMAN_OWNED"
  | "SUPERSEDED"
  | "CANCELLED";

export interface TaskRecord {
  readonly taskId: string;
  readonly featureId: string;
  readonly state: TaskState;
  readonly writeScope: readonly string[];
  readonly downstreamTaskIds: readonly string[];
  readonly activeWorkerPid: number | null;
  readonly checkpointRef: string;
  readonly humanAuthoredPaths: readonly string[];
  readonly verificationStatus: string;
  readonly overriddenCheckIds: readonly string[];
}

export interface DeveloperIdentity {
  readonly name: string;
  readonly email: string;
}

export interface TakeoverRequest {
  readonly taskId: string;
  readonly entry: HumanFixEntryKind;
  readonly hint?: string;
  readonly commitSha?: string;
}

export interface TakeoverResult {
  readonly taskId: string;
  readonly state: typeof import("./constants.js").HUMAN_OWNED;
  readonly haltedWorkerPid: number | null;
  readonly pausedDownstreamTaskIds: readonly string[];
  readonly entry: HumanFixEntryKind;
}

export interface WorkspacePickerOption {
  readonly id: WorkspaceChoice;
  readonly label: string;
  readonly recommended: boolean;
  readonly vscodeCommand?: string;
}

export interface WorkspacePickerResult {
  readonly taskId: string;
  readonly choice: WorkspaceChoice;
  readonly worktreePath?: string;
  readonly options: readonly WorkspacePickerOption[];
}

export interface ChangedFile {
  readonly path: string;
  readonly status: "modified" | "added" | "deleted";
  readonly untracked?: boolean;
}

export interface CleanVerifyStage {
  readonly id: string;
  readonly label: string;
  readonly ok: boolean;
  readonly detail?: string;
}

export interface CleanVerifyResult {
  readonly ok: boolean;
  readonly stages: readonly CleanVerifyStage[];
  readonly commitSha: string;
  readonly author: DeveloperIdentity;
  readonly trailers: Readonly<Record<string, string>>;
}

export interface ScopeReconcilePrompt {
  readonly kind: "extra_file" | "contract_delta" | "untracked_include";
  readonly path: string;
  readonly message: string;
  readonly contractField?: string;
}

export interface ScopeReconcileResult {
  readonly includedPaths: readonly string[];
  readonly contractUpdates: readonly { readonly contractId: string; readonly field: string; readonly basis: "explicit" }[];
  readonly heldSiblingTaskIds: readonly string[];
  readonly prompts: readonly ScopeReconcilePrompt[];
}

export interface FailingCheck {
  readonly id: string;
  readonly title: string;
  readonly output: string;
  readonly sealed?: boolean;
}

export interface OverrideChoice {
  readonly kind: typeof import("./constants.js").OVERRIDE_FIX_CODE | typeof import("./constants.js").OVERRIDE_TEST_WRONG | typeof import("./constants.js").OVERRIDE_ACCEPT_ANYWAY;
  readonly reason?: string;
}

export interface OverrideResult {
  readonly landed: boolean;
  readonly verificationStatus: string;
  readonly overriddenCheckIds: readonly string[];
  readonly updatedSpecIds: readonly string[];
  readonly landingSummaryLine?: string;
}

export interface HandBackRequest {
  readonly taskId: string;
  readonly keepEdits: boolean;
  readonly guidanceNote: string;
}

export interface HandBackResult {
  readonly taskId: string;
  readonly resumedState: TaskState;
  readonly wipCommitSha: string | null;
  readonly guidanceNote: string;
}

export interface MergeHandoff {
  readonly taskId: string;
  readonly commitSha: string;
  readonly author: DeveloperIdentity;
  readonly unblockedDownstreamTaskIds: readonly string[];
}

export interface HumanFixReceipt {
  readonly taskId: string;
  readonly acceptedBy: "human";
  readonly commitSha: string;
  readonly verificationStatus: string;
  readonly overriddenCheckIds: readonly string[];
  readonly author: DeveloperIdentity;
}