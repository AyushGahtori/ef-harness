export {
  assertLineEndingsPreserved,
  assertNeverMutatesDeveloperCheckout,
  buildGitArgs,
  commandIsReadOnly,
  extractSubcommand,
  isLineEndingOverride,
  isStatusCommand,
} from "./classify.js";
export { detectCaseCollisions } from "./case-collisions.js";
export { execGit } from "./exec-git.js";
export { initializeNewRepo } from "./init-repo.js";
export { assertHarnessOperationsAllowed, detectSyncWarning, inspectWorkspaceFolder } from "./inspect-folder.js";
export { parseMergeTreeOutput, predictMergeTree } from "./merge-tree.js";
export { bundledMinGitPath, normalizeRepoPath, normalizeWindowsPath, scrubGitEnv } from "./paths.js";
export { parsePorcelainZ } from "./porcelain.js";
export { runProcess } from "./process-runner.js";
export {
  clearGitVersionCache,
  ensureSupportedGit,
  formatGitVersion,
  gitVersionAtLeast,
  parseGitVersion,
  resolveGitBinary,
} from "./resolve-binary.js";
export {
  DeveloperCheckoutMutationError,
  FOLDER_STATES,
  GIT_BUSY_MESSAGE,
  GIT_VERSION_REQUIREMENT_MESSAGE,
  GitBinaryNotFoundError,
  GitCommandError,
  GitVersionRejectedError,
  LineEndingProtectionError,
  MID_OPERATION_ACTION,
  MINIMUM_GIT_VERSION,
  MidOperationBlockedError,
  WORK_ON_A_COPY_OFFER,
} from "./types.js";
export type {
  CaseCollision,
  CaseCollisionReport,
  DetectCaseCollisionsOptions,
  DirtyFile,
  ExecGitOptions,
  ExecGitResult,
  FolderStateId,
  FolderStateResult,
  GitVersion,
  IdentityStatus,
  InitializeNewRepoOptions,
  InitializeNewRepoResult,
  InspectWorkspaceFolderOptions,
  MergeTreePrediction,
  MidOperationInfo,
  OtherVcsInfo,
  PredictMergeTreeOptions,
  ResolvedGitBinary,
  ResolveGitBinaryOptions,
  SettingsGitRejection,
  StructuredLogFields,
  StructuredLogger,
  SyncWarning,
  WorkOnCopyOptions,
  WorkOnCopyResult,
} from "./types.js";
export { workOnACopy } from "./work-on-copy.js";

import { assertNeverMutatesDeveloperCheckout } from "./classify.js";
import { detectCaseCollisions } from "./case-collisions.js";
import { execGit } from "./exec-git.js";
import { initializeNewRepo } from "./init-repo.js";
import { inspectWorkspaceFolder } from "./inspect-folder.js";
import { predictMergeTree } from "./merge-tree.js";
import { resolveGitBinary } from "./resolve-binary.js";
import { workOnACopy } from "./work-on-copy.js";

export const GitRunner = {
  execGit,
  resolveGitBinary,
  assertNeverMutatesDeveloperCheckout,
};

export const FolderStateInspector = {
  inspectWorkspaceFolder,
  initializeNewRepo,
  workOnACopy,
  predictMergeTree,
  detectCaseCollisions,
};
