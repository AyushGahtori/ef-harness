/**
 * Structural logger consumed from Task 011 (`StructuredLogger`).
 * Callers pass the shared logger; this package does not deep-import telemetry.
 */
export interface StructuredLogFields {
  readonly [key: string]: string | number | boolean;
}

export interface StructuredLogger {
  debug(message: string, fields?: StructuredLogFields): void;
  info(message: string, fields?: StructuredLogFields): void;
  warn(message: string, fields?: StructuredLogFields): void;
  error(message: string, fields?: StructuredLogFields): void;
}

export const GIT_BUSY_MESSAGE = "Git busy in another process";

export const GIT_VERSION_REQUIREMENT_MESSAGE =
  "Requires Git 2.38+ for in-memory merge-tree";

export const MID_OPERATION_ACTION = "Open in my editor + Re-check";

export const WORK_ON_A_COPY_OFFER = "Work on a copy";

export const MINIMUM_GIT_VERSION: GitVersion = {
  major: 2,
  minor: 38,
  patch: 0,
};

export interface GitVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

export interface ExecGitOptions {
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs?: number;
  readonly env?: NodeJS.ProcessEnv;
  readonly stdin?: string;
  readonly gitBinary?: string;
  readonly developerCheckout?: boolean;
  readonly userExplicitConsentToken?: string;
  readonly logger?: StructuredLogger;
  readonly resourcesRoot?: string;
  readonly settingsGitPath?: string;
  readonly maxLockRetries?: number;
}

export interface ExecGitResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly busyMessage: string | null;
  readonly gitPath: string;
  readonly argv: readonly string[];
}

export interface SettingsGitRejection {
  readonly path: string;
  readonly version: string | null;
  readonly message: string;
}

export interface ResolvedGitBinary {
  readonly gitPath: string;
  readonly source: "bundled" | "settings" | "path";
  readonly version: string;
  readonly settingsRejection: SettingsGitRejection | null;
}

export interface VersionProbeResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ResolveGitBinaryOptions {
  readonly resourcesRoot?: string;
  readonly settingsGitPath?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly logger?: StructuredLogger;
  readonly timeoutMs?: number;
  readonly runVersion?: (binary: string) => Promise<VersionProbeResult>;
}

export const FOLDER_STATES = [
  "empty",
  "files_no_git",
  "git_clean",
  "git_dirty",
  "git_unborn",
  "git_mid_operation",
  "git_detached_head",
  "other_vcs",
  "synced_or_network_folder",
  "missing_git_identity",
  "shallow_clone",
] as const;

export type FolderStateId = (typeof FOLDER_STATES)[number];

export type DirtyKind =
  | "modified"
  | "untracked"
  | "deleted"
  | "renamed"
  | "copied"
  | "added"
  | "unmerged"
  | "typechange"
  | "ignored";

export interface DirtyFile {
  readonly code: string;
  readonly path: string;
  readonly originalPath: string | null;
  readonly kind: DirtyKind;
}

export type MidOperationKind = "merge" | "rebase" | "cherry_pick" | "revert" | "conflicts";

export interface MidOperationInfo {
  readonly active: true;
  readonly kinds: readonly MidOperationKind[];
  readonly markers: readonly string[];
  readonly blocked: true;
  readonly mayFinishOrAbort: false;
  readonly action: typeof MID_OPERATION_ACTION;
}

export interface OtherVcsInfo {
  readonly systems: readonly ("mercurial" | "perforce")[];
  readonly offer: typeof WORK_ON_A_COPY_OFFER;
}

export type SyncKind = "onedrive" | "dropbox" | "icloud" | "unc";

export interface SyncWarning {
  readonly kinds: readonly SyncKind[];
  readonly nonBlocking: true;
  readonly actions: readonly ["Continue", "Move project"];
  readonly message: string;
}

export interface IdentityStatus {
  readonly name: string | null;
  readonly email: string | null;
  readonly missing: boolean;
}

export interface FolderStateResult {
  readonly folder: string;
  readonly primary: FolderStateId;
  readonly states: readonly FolderStateId[];
  readonly head: string | null;
  readonly branch: string | null;
  readonly detached: boolean;
  readonly dirtyCount: number;
  readonly dirtyFiles: readonly DirtyFile[];
  readonly midOperation: MidOperationInfo | null;
  readonly otherVcs: OtherVcsInfo | null;
  readonly syncWarning: SyncWarning | null;
  readonly identity: IdentityStatus;
  readonly shallow: boolean;
  readonly gitBusy: boolean;
  readonly gitBusyMessage: string | null;
  readonly statusReliable: boolean;
  readonly onlyOsJunk: boolean;
  readonly accessError: string | null;
  readonly gitDir: string | null;
  readonly actions: readonly string[];
}

export interface InspectWorkspaceFolderOptions {
  readonly gitBinary?: string;
  readonly resourcesRoot?: string;
  readonly settingsGitPath?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly logger?: StructuredLogger;
  readonly timeoutMs?: number;
}

export interface InitializeNewRepoOptions {
  readonly cwd: string;
  readonly userExplicitConsentToken: string;
  readonly gitBinary?: string;
  readonly resourcesRoot?: string;
  readonly settingsGitPath?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly logger?: StructuredLogger;
  readonly timeoutMs?: number;
}

export interface InitializeNewRepoResult {
  readonly folder: string;
  readonly branch: "main";
  readonly git: ExecGitResult;
}

export interface WorkOnCopyOptions {
  readonly source: string;
  readonly destination: string;
  readonly userExplicitConsentToken: string;
  readonly gitBinary?: string;
  readonly resourcesRoot?: string;
  readonly settingsGitPath?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly logger?: StructuredLogger;
  readonly timeoutMs?: number;
}

export interface WorkOnCopyResult {
  readonly source: string;
  readonly destination: string;
  readonly copiedPaths: readonly string[];
  readonly skippedPaths: readonly string[];
  readonly initializedBranch: "main";
  readonly git: ExecGitResult;
}

export interface PredictMergeTreeOptions {
  readonly cwd: string;
  readonly ours: string;
  readonly theirs: string;
  readonly gitBinary?: string;
  readonly resourcesRoot?: string;
  readonly settingsGitPath?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly logger?: StructuredLogger;
  readonly timeoutMs?: number;
  readonly developerCheckout?: boolean;
}

export interface MergeTreePrediction {
  readonly clean: boolean;
  readonly treeOid: string | null;
  readonly conflictingPaths: readonly string[];
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}

export interface DetectCaseCollisionsOptions {
  readonly cwd: string;
  readonly revision?: string;
  readonly gitBinary?: string;
  readonly resourcesRoot?: string;
  readonly settingsGitPath?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly logger?: StructuredLogger;
  readonly timeoutMs?: number;
  readonly developerCheckout?: boolean;
}

export interface CaseCollision {
  readonly key: string;
  readonly paths: readonly string[];
}

export interface CaseCollisionReport {
  readonly collisions: readonly CaseCollision[];
}

export class DeveloperCheckoutMutationError extends Error {
  readonly code = "DEVELOPER_CHECKOUT_MUTATION_BLOCKED";
  readonly subcommand: string;

  constructor(subcommand: string) {
    super(
      `Refusing to run mutating git command "${subcommand}" in the developer checkout without an explicit user consent token.`,
    );
    this.name = "DeveloperCheckoutMutationError";
    this.subcommand = subcommand;
  }
}

export class LineEndingProtectionError extends Error {
  readonly code = "GIT_LINE_ENDING_PROTECTED";

  constructor() {
    super(
      "Refusing to override core.autocrlf. Line endings follow the repo .gitattributes and the developer's configured core.autocrlf.",
    );
    this.name = "LineEndingProtectionError";
  }
}

export class GitVersionRejectedError extends Error {
  readonly code = "GIT_VERSION_TOO_OLD";
  readonly binaryPath: string;
  readonly detectedVersion: string | null;

  constructor(binaryPath: string, detectedVersion: string | null) {
    const detected = detectedVersion ? ` (git version ${detectedVersion})` : "";
    super(
      `${GIT_VERSION_REQUIREMENT_MESSAGE}. Rejected ${binaryPath}${detected}. Use bundled MinGit.`,
    );
    this.name = "GitVersionRejectedError";
    this.binaryPath = binaryPath;
    this.detectedVersion = detectedVersion;
  }
}

export class GitBinaryNotFoundError extends Error {
  readonly code = "GIT_BINARY_NOT_FOUND";

  constructor(message: string) {
    super(message);
    this.name = "GitBinaryNotFoundError";
  }
}

export class MidOperationBlockedError extends Error {
  readonly code = "GIT_MID_OPERATION_BLOCKED";

  constructor() {
    super(
      `Git is in the middle of a merge, rebase, cherry-pick, revert, or conflict. ${MID_OPERATION_ACTION}. The harness will not finish or abort it.`,
    );
    this.name = "MidOperationBlockedError";
  }
}

export class GitCommandError extends Error {
  readonly code = "GIT_COMMAND_FAILED";
  readonly exitCode: number | null;
  readonly stderr: string;

  constructor(message: string, exitCode: number | null, stderr: string) {
    super(message);
    this.name = "GitCommandError";
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}
