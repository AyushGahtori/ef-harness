export const REENTRY_AWAITING_RESUME = "REENTRY_AWAITING_RESUME" as const;

export const COLD_OPEN_DOMAINS = [
  "kernel_state",
  "worktrees",
  "developer_repo",
  "offline_views",
  "lockfile",
  "connections_clis",
  "human_steps_questions",
] as const;

export type ColdOpenDomainId = (typeof COLD_OPEN_DOMAINS)[number];

export type GatePhase =
  | "OPEN"
  | typeof REENTRY_AWAITING_RESUME
  | "REVIEWING_DRIFT"
  | "STAY_PAUSED"
  | "RESUMED";

export type BlockedActivity = "start_worker" | "edit_file" | "spend_tokens" | "mutate_git";

export type ResumeClick =
  | "Resume"
  | "Resume Build"
  | "Review changes first"
  | "Review Drift First"
  | "Stay Paused";

export type ReopenReason = "first_open" | "app_restart" | "crash" | "parked" | "wake";

export type ShellCloseReason = "clean_quit" | "crash" | "parked" | "sleep" | "first_open";

export type KnownCliName = "codex" | "claude" | "copilot" | "cursor" | "opencode";

export const KNOWN_CLI_NAMES: readonly KnownCliName[] = [
  "codex",
  "claude",
  "copilot",
  "cursor",
  "opencode",
];

export interface AttemptRecord {
  readonly id: string;
  readonly taskId: string;
  readonly status: "WORKING" | "CHECKPOINTED" | "DONE";
  readonly pid: number | null;
  readonly checkpointRef: string | null;
  readonly wipDiffPreserved: boolean;
}

export interface RemainingTask {
  readonly id: string;
  readonly title: string;
}

export interface ParkedTask {
  readonly id: string;
  readonly title: string;
  readonly progressLabel: string;
}

export interface FinishedFeature {
  readonly id: string;
  readonly title: string;
  readonly landedOn: string;
}

export interface WorktreeExpectation {
  readonly slotId: string;
  readonly path: string;
  readonly expectedHead: string;
}

export interface ViewHashRecord {
  readonly path: string;
  readonly sha256: string;
}

export interface LockHashes {
  readonly packageJson: string | null;
  readonly pnpmLock: string | null;
}

export interface ProviderConnectionSnapshot {
  readonly provider: string;
  readonly allowanceLabel: string;
  readonly previousUsedPercent: number | null;
  readonly tokenExpiresAt: string | null;
}

export interface CliVersionRecord {
  readonly name: KnownCliName;
  readonly version: string;
}

export interface HumanStepRecord {
  readonly id: string;
  readonly label: string;
  readonly status: "pending" | "failed" | "verified";
  readonly probeId: string;
}

export interface OpenQuestionRecord {
  readonly id: string;
  readonly prompt: string;
  readonly openedAt: string;
  readonly targetFiles: readonly string[];
  readonly decisionContext: string | null;
  readonly neededByTaskId: string | null;
  readonly effectHint: string | null;
  readonly revalidation: "still_relevant" | "obsolete";
  readonly sinceLabel: string | null;
}

export interface FailedTaskRecord {
  readonly id: string;
  readonly writeScope: readonly string[];
  readonly failingChecks: readonly string[];
}

export interface StateDbSnapshot {
  readonly projectId: string;
  readonly snapshotId: string;
  readonly projectName: string;
  readonly projectRoot: string;
  readonly lastActiveAt: string;
  readonly phaseLabel: string;
  readonly whyStopped: string;
  readonly expectedIntegrationHead: string;
  readonly recordedBranch: string;
  readonly recordedHead: string;
  readonly recordedOriginMain: string | null;
  readonly walOk: boolean;
  readonly walDetail: string;
  readonly attempts: readonly AttemptRecord[];
  readonly remainingTasks: readonly RemainingTask[];
  readonly parkedTasks: readonly ParkedTask[];
  readonly finishedFeatures: readonly FinishedFeature[];
  readonly costEstimate: string;
  readonly windowLabel: string;
  readonly lockHashes: LockHashes;
  readonly viewHashes: readonly ViewHashRecord[];
  readonly worktrees: readonly WorktreeExpectation[];
  readonly connections: readonly ProviderConnectionSnapshot[];
  readonly cliVersions: readonly CliVersionRecord[];
  readonly humanSteps: readonly HumanStepRecord[];
  readonly questions: readonly OpenQuestionRecord[];
  readonly failedTasks: readonly FailedTaskRecord[];
}

export interface SpendLedger {
  tokens: number;
  cents: number;
  calls: string[];
}

export interface ColdOpenInput {
  readonly snapshot: StateDbSnapshot;
  readonly nowIso: string;
  readonly reopen: ReopenReason;
  readonly buildWasInProgress: boolean;
  readonly sleepMinutes: number | null;
  readonly offline: boolean;
  readonly repoChanged: boolean;
  readonly networkChanged: boolean;
  readonly forceHold: boolean;
  readonly lastActiveLabel: string | null;
  readonly ledger: SpendLedger;
  readonly gate: ReentryGate | null;
}

export interface DomainFinding {
  readonly code: string;
  readonly message: string;
}

export interface DomainResult {
  readonly id: ColdOpenDomainId;
  readonly checked: true;
  readonly ok: boolean;
  readonly findings: readonly DomainFinding[];
}

export interface ObservedCommit {
  readonly sha: string;
  readonly subject: string;
  readonly files: readonly string[];
  readonly kind: "local" | "upstream";
}

export interface RepoInspection {
  readonly missing: false;
  readonly branch: string;
  readonly head: string;
  readonly integrationHead: string | null;
  readonly originMainHead: string | null;
  readonly dirtyFiles: readonly string[];
  readonly commits: readonly ObservedCommit[];
  readonly indexLockPath: string | null;
  readonly indexLockMtimeMs: number | null;
  readonly readError: string | null;
}

export interface MissingRepo {
  readonly missing: true;
  readonly code: "ENOENT";
  readonly message: string;
}

export interface WorktreeAuditEntry {
  readonly slotId: string;
  readonly path: string;
  readonly state: "present" | "stale" | "locked" | "deleted";
  readonly liveHead: string | null;
  readonly indexLockPath: string | null;
  readonly indexLockMtimeMs: number | null;
}

export interface ConnectionObservation {
  readonly provider: string;
  readonly usedPercent: number | null;
  readonly allowanceReset: boolean;
  readonly fiveHourReset: boolean;
  readonly weeklyReset: boolean;
  readonly tokenExpired: boolean;
  readonly expiresInDays: number | null;
}

export interface LockfileObservation {
  readonly packageJson: string | null;
  readonly pnpmLock: string | null;
}

export interface DiskObservation {
  readonly ok: boolean;
  readonly freeBytes: number;
  readonly detail: string;
}

export interface LockDecision {
  readonly present: boolean;
  readonly safe: boolean;
  readonly reason: string;
  readonly lockPath: string;
}

export interface CommitAnsweredMatch {
  readonly matchId: string;
  readonly commitSha: string;
  readonly shortSha: string;
  readonly commitSubject: string;
  readonly taskId: string | null;
  readonly questionId: string | null;
  readonly overlappingFiles: readonly string[];
  readonly offers: readonly string[];
  readonly autoClosed: false;
  readonly resolution: "awaiting_confirmation";
}

export interface RetiredQuestion {
  readonly questionId: string;
  readonly note: string;
}

export interface QuestionRecap {
  readonly questionId: string;
  readonly recap: string;
}

export interface ProposedAction {
  readonly type: string;
  readonly detail: string;
  readonly requiresConfirmation: boolean;
  readonly matchId: string | null;
  readonly lockPath: string | null;
  readonly paths: readonly string[];
  readonly shas: readonly string[];
}

export interface ColdOpenReport {
  readonly domains: readonly DomainResult[];
  readonly elapsedMs: number;
  readonly showWelcome: boolean;
  readonly folderMissing: boolean;
  readonly relocatePrompt: string | null;
  readonly gate: ReentryGate;
  readonly tokensSpent: number;
  readonly centsSpent: number;
  readonly paidCallBlocked: boolean;
  readonly mutations: readonly string[];
  readonly integrationHead: string;
  readonly integrationHeadMatches: boolean;
  readonly orphans: readonly AttemptRecord[];
  readonly interruptedMessage: string | null;
  readonly branchPrompt: string | null;
  readonly lockfilePrompts: readonly string[];
  readonly allowanceMessages: readonly string[];
  readonly staleContextReminder: string | null;
  readonly wakeNote: string | null;
  readonly commitAnswered: readonly CommitAnsweredMatch[];
  readonly retiredQuestions: readonly RetiredQuestion[];
  readonly questionRecaps: readonly QuestionRecap[];
  readonly autoVerifiedHumanStepIds: readonly string[];
  readonly actions: readonly ProposedAction[];
  readonly whereWeLeftOff: readonly string[];
  readonly whatChanged: readonly string[];
  readonly readyLines: readonly string[];
  readonly projectId: string;
  readonly snapshotId: string;
  readonly readFailed: boolean;
  readonly reopen: ReopenReason;
}

/**
 * Structural import cycle is avoided by typing the gate as an interface here
 * and having the class implement it. Callers still use the class from the gate module.
 */
export interface ReentryGate {
  readonly phase: GatePhase;
  open(input: GateOpenInput): GatePhase;
  markReconciliationFinished(): void;
  grantResumeClearance(): void;
  tryActivity(activity: BlockedActivity): {
    readonly allowed: boolean;
    readonly phase: GatePhase;
    readonly activity: BlockedActivity;
  };
  assertCan(activity: BlockedActivity): void;
  click(action: ResumeClick): GatePhase;
}

export interface GateOpenInput {
  readonly reopen: ReopenReason;
  readonly buildWasInProgress: boolean;
  readonly sleepMinutes: number | null;
  readonly repoChanged: boolean;
  readonly networkChanged: boolean;
  readonly offline: boolean;
  readonly forceHold: boolean;
  readonly untouchedNewIdleProject: boolean;
}
