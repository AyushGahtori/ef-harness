import fs from "node:fs";
import path from "node:path";
import { commandIsReadOnly } from "./classify.js";
import { execGit } from "./exec-git.js";
import { resolveGitBinary } from "./resolve-binary.js";
import {
  ancestorHasEntry,
  directoryExists,
  hasPathSegment,
  isOsJunkName,
  isUncPath,
  normalizeRepoPath,
  normalizeWindowsPath,
  pathIsInside,
} from "./paths.js";
import { parsePorcelainZ } from "./porcelain.js";
import {
  FOLDER_STATES,
  GIT_BUSY_MESSAGE,
  MID_OPERATION_ACTION,
  MidOperationBlockedError,
  WORK_ON_A_COPY_OFFER,
  type DirtyFile,
  type ExecGitResult,
  type FolderStateId,
  type FolderStateResult,
  type IdentityStatus,
  type InspectWorkspaceFolderOptions,
  type MidOperationInfo,
  type MidOperationKind,
  type OtherVcsInfo,
  type StructuredLogger,
  type SyncKind,
  type SyncWarning,
} from "./types.js";

const PRIMARY_PRIORITY: readonly FolderStateId[] = [
  "git_mid_operation",
  "git_unborn",
  "git_detached_head",
  "git_dirty",
  "git_clean",
  "other_vcs",
  "files_no_git",
  "empty",
  "synced_or_network_folder",
  "missing_git_identity",
  "shallow_clone",
];

const MARKERS: readonly { readonly name: string; readonly kind: MidOperationKind }[] = [
  { name: "MERGE_HEAD", kind: "merge" },
  { name: "rebase-merge", kind: "rebase" },
  { name: "rebase-apply", kind: "rebase" },
  { name: "CHERRY_PICK_HEAD", kind: "cherry_pick" },
  { name: "REVERT_HEAD", kind: "revert" },
];

function choosePrimary(matched: ReadonlySet<FolderStateId>): FolderStateId {
  for (const state of PRIMARY_PRIORITY) {
    if (matched.has(state)) return state;
  }
  return "empty";
}

function actionsFor(primary: FolderStateId, identityMissing: boolean): string[] {
  const actions: string[] = [];
  switch (primary) {
    case "empty":
      actions.push("Silent git init");
      break;
    case "files_no_git":
      actions.push("Set up Git here", WORK_ON_A_COPY_OFFER);
      break;
    case "git_dirty":
      actions.push("Include my changes", "Start from my last commit", "Let me commit first");
      break;
    case "git_unborn":
      actions.push("Review baseline commit");
      break;
    case "git_mid_operation":
      actions.push(MID_OPERATION_ACTION);
      break;
    case "git_detached_head":
      actions.push("Pick a branch", "Create harness-base branch");
      break;
    case "other_vcs":
      actions.push(WORK_ON_A_COPY_OFFER);
      break;
    case "synced_or_network_folder":
      actions.push("Continue", "Move project");
      break;
    case "missing_git_identity":
      actions.push("Prompt for user.name and user.email");
      break;
    case "git_clean":
    case "shallow_clone":
      break;
    default:
      break;
  }
  if (identityMissing && primary !== "missing_git_identity") {
    actions.push("Prompt for user.name and user.email");
  }
  return actions;
}

export function detectSyncWarning(folder: string, env: NodeJS.ProcessEnv): SyncWarning | null {
  const kinds = new Set<SyncKind>();
  const unc = isUncPath(folder);
  if (unc) kinds.add("unc");
  for (const root of [env.OneDrive, env.OneDriveCommercial, env.OneDriveConsumer]) {
    if (typeof root === "string" && root.trim() && pathIsInside(folder, root)) kinds.add("onedrive");
  }
  const profile = env.USERPROFILE || env.HOME;
  const insideIcloud =
    typeof profile === "string" && profile.trim().length > 0 && pathIsInside(folder, path.join(profile, "iCloudDrive"));
  if (insideIcloud || hasPathSegment(folder, "iCloudDrive")) kinds.add("icloud");
  if (!unc && fs.existsSync(folder)) {
    if (ancestorHasEntry(folder, ".dropbox")) kinds.add("dropbox");
    if (ancestorHasEntry(folder, ".icloud")) kinds.add("icloud");
  }
  if (kinds.size === 0) return null;
  const ordered = (["dropbox", "icloud", "onedrive", "unc"] as const).filter((kind) => kinds.has(kind));
  return {
    kinds: ordered,
    nonBlocking: true,
    actions: ["Continue", "Move project"],
    message: "Sync tools and network folders lock files and slow builds.",
  };
}

async function directoryContainsOnlyOsJunk(folder: string): Promise<boolean> {
  let sawJunk = false;
  let sawReal = false;
  const walk = async (current: string): Promise<void> => {
    const entries = await fs.promises.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === ".hg") continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (isOsJunkName(entry.name)) sawJunk = true;
      else sawReal = true;
    }
  };
  await walk(folder);
  return sawJunk && !sawReal;
}

function resolvePrintedPath(cwd: string, printed: string): string {
  return path.resolve(cwd, printed.trim().replaceAll('"', ""));
}

export function assertHarnessOperationsAllowed(result: FolderStateResult): void {
  if (result.midOperation || result.primary === "git_mid_operation" || result.states.includes("git_mid_operation")) {
    throw new MidOperationBlockedError();
  }
}

interface CallContext {
  readonly folder: string;
  readonly env: NodeJS.ProcessEnv;
  readonly gitBinary: string;
  readonly timeoutMs: number;
  readonly logger?: StructuredLogger;
}

async function runReadOnly(ctx: CallContext, args: readonly string[]): Promise<ExecGitResult> {
  if (!commandIsReadOnly(args)) {
    throw new Error(`inspectWorkspaceFolder refused a non-read-only git command: ${args.join(" ")}`);
  }
  return execGit({
    args,
    cwd: ctx.folder,
    env: ctx.env,
    gitBinary: ctx.gitBinary,
    timeoutMs: ctx.timeoutMs,
    developerCheckout: true,
    ...(ctx.logger !== undefined ? { logger: ctx.logger } : {}),
  });
}

function blankIdentity(): IdentityStatus {
  return { name: null, email: null, missing: false };
}

function buildResult(input: {
  readonly folder: string;
  readonly matched: ReadonlySet<FolderStateId>;
  readonly head: string | null;
  readonly branch: string | null;
  readonly detached: boolean;
  readonly dirtyFiles: readonly DirtyFile[];
  readonly midOperation: MidOperationInfo | null;
  readonly otherVcs: OtherVcsInfo | null;
  readonly syncWarning: SyncWarning | null;
  readonly identity: IdentityStatus;
  readonly shallow: boolean;
  readonly gitBusy: boolean;
  readonly statusReliable: boolean;
  readonly onlyOsJunk: boolean;
  readonly accessError: string | null;
  readonly gitDir: string | null;
}): FolderStateResult {
  const primary = choosePrimary(input.matched);
  const actions = actionsFor(primary, input.identity.missing);
  if (input.gitBusy) actions.unshift(GIT_BUSY_MESSAGE);
  if (input.syncWarning) {
    for (const action of input.syncWarning.actions) {
      if (!actions.includes(action)) actions.push(action);
    }
  }
  return {
    folder: input.folder,
    primary,
    states: FOLDER_STATES.filter((state) => input.matched.has(state)),
    head: input.head,
    branch: input.branch,
    detached: input.detached,
    dirtyCount: input.dirtyFiles.length,
    dirtyFiles: input.dirtyFiles,
    midOperation: input.midOperation,
    otherVcs: input.otherVcs,
    syncWarning: input.syncWarning,
    identity: input.identity,
    shallow: input.shallow,
    gitBusy: input.gitBusy,
    gitBusyMessage: input.gitBusy ? GIT_BUSY_MESSAGE : null,
    statusReliable: input.statusReliable,
    onlyOsJunk: input.onlyOsJunk,
    accessError: input.accessError,
    gitDir: input.gitDir,
    actions,
  };
}

async function readIdentity(ctx: CallContext): Promise<IdentityStatus> {
  const nameResult = await runReadOnly(ctx, ["config", "--get", "user.name"]);
  const emailResult = await runReadOnly(ctx, ["config", "--get", "user.email"]);
  const name = nameResult.exitCode === 0 ? nameResult.stdout.trim() : "";
  const email = emailResult.exitCode === 0 ? emailResult.stdout.trim() : "";
  const presentName = name.length > 0 ? name : null;
  const presentEmail = email.length > 0 ? email : null;
  return {
    name: presentName,
    email: presentEmail,
    missing: presentName === null || presentEmail === null,
  };
}

function otherVcsOf(folder: string): OtherVcsInfo | null {
  const systems: ("mercurial" | "perforce")[] = [];
  if (fs.existsSync(path.join(folder, ".hg"))) systems.push("mercurial");
  if (fs.existsSync(path.join(folder, ".p4config"))) systems.push("perforce");
  if (systems.length === 0) return null;
  return { systems, offer: WORK_ON_A_COPY_OFFER };
}

export async function inspectWorkspaceFolder(
  folder: string,
  options: InspectWorkspaceFolderOptions = {},
): Promise<FolderStateResult> {
  const env = options.env ?? process.env;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const normalizedInput = process.platform === "win32" ? normalizeWindowsPath(folder) : path.resolve(folder);
  const syncWarning = detectSyncWarning(folder, env) ?? detectSyncWarning(normalizedInput, env);
  const exists = directoryExists(normalizedInput);
  if (!exists) {
    const matched = new Set<FolderStateId>();
    if (syncWarning) matched.add("synced_or_network_folder");
    return buildResult({
      folder: normalizedInput,
      matched,
      head: null,
      branch: null,
      detached: false,
      dirtyFiles: [],
      midOperation: null,
      otherVcs: null,
      syncWarning,
      identity: blankIdentity(),
      shallow: false,
      gitBusy: false,
      statusReliable: false,
      onlyOsJunk: false,
      accessError: "Folder does not exist or is not a directory.",
      gitDir: null,
    });
  }

  const resolvedFolder = normalizeRepoPath(normalizedInput);
  const entries = await fs.promises.readdir(resolvedFolder, { withFileTypes: true });
  const otherVcs = otherVcsOf(resolvedFolder);
  const onlyOsJunk = entries.length > 0 && (await directoryContainsOnlyOsJunk(resolvedFolder));
  const gitBinary =
    options.gitBinary ??
    (
      await resolveGitBinary({
        ...(options.resourcesRoot !== undefined ? { resourcesRoot: options.resourcesRoot } : {}),
        ...(options.settingsGitPath !== undefined ? { settingsGitPath: options.settingsGitPath } : {}),
        env,
        ...(options.logger !== undefined ? { logger: options.logger } : {}),
        timeoutMs,
      })
    ).gitPath;
  const ctx: CallContext = {
    folder: resolvedFolder,
    env,
    gitBinary,
    timeoutMs,
    ...(options.logger !== undefined ? { logger: options.logger } : {}),
  };
  const identity = await readIdentity(ctx);
  const inside = await runReadOnly(ctx, ["rev-parse", "--is-inside-work-tree"]);
  const isRepo = inside.exitCode === 0 && inside.stdout.trim() === "true";
  const matched = new Set<FolderStateId>();
  if (syncWarning) matched.add("synced_or_network_folder");
  if (identity.missing) matched.add("missing_git_identity");
  if (otherVcs) matched.add("other_vcs");

  if (!isRepo) {
    if (!otherVcs) {
      if (entries.length === 0) matched.add("empty");
      else matched.add("files_no_git");
    }
    return buildResult({
      folder: resolvedFolder,
      matched,
      head: null,
      branch: null,
      detached: false,
      dirtyFiles: [],
      midOperation: null,
      otherVcs,
      syncWarning,
      identity,
      shallow: false,
      gitBusy: false,
      statusReliable: true,
      onlyOsJunk,
      accessError: null,
      gitDir: null,
    });
  }

  const gitDirResult = await runReadOnly(ctx, ["rev-parse", "--git-dir"]);
  const gitDir = gitDirResult.exitCode === 0 ? resolvePrintedPath(resolvedFolder, gitDirResult.stdout) : null;
  const headResult = await runReadOnly(ctx, ["rev-parse", "--verify", "HEAD"]);
  const unborn = headResult.exitCode !== 0;
  const head = unborn ? null : headResult.stdout.trim();
  const symbolic = await runReadOnly(ctx, ["symbolic-ref", "-q", "HEAD"]);
  const detached = !unborn && symbolic.exitCode !== 0;
  let branch: string | null = null;
  if (symbolic.exitCode === 0) {
    const ref = symbolic.stdout.trim();
    branch = ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
  }

  const markerNames: string[] = [];
  const kinds: MidOperationKind[] = [];
  for (const marker of MARKERS) {
    const printed = await runReadOnly(ctx, ["rev-parse", "--git-path", marker.name]);
    if (printed.exitCode !== 0) continue;
    const markerPath = resolvePrintedPath(resolvedFolder, printed.stdout);
    if (fs.existsSync(markerPath)) {
      markerNames.push(marker.name);
      if (!kinds.includes(marker.kind)) kinds.push(marker.kind);
    }
  }

  const status = await runReadOnly(ctx, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const gitBusy = status.busyMessage !== null;
  const statusReliable = !gitBusy && !status.timedOut && status.exitCode === 0;
  const dirtyFiles = statusReliable ? parsePorcelainZ(status.stdout) : [];
  if (dirtyFiles.some((file) => file.kind === "unmerged")) {
    markerNames.push("unmerged-paths");
    if (!kinds.includes("conflicts")) kinds.push("conflicts");
  }
  const midOperation: MidOperationInfo | null =
    kinds.length > 0
      ? {
          active: true,
          kinds,
          markers: markerNames,
          blocked: true,
          mayFinishOrAbort: false,
          action: MID_OPERATION_ACTION,
        }
      : null;

  const shallowResult = await runReadOnly(ctx, ["rev-parse", "--is-shallow-repository"]);
  const shallow = shallowResult.exitCode === 0 && shallowResult.stdout.trim() === "true";

  if (unborn) matched.add("git_unborn");
  if (detached) matched.add("git_detached_head");
  if (midOperation) matched.add("git_mid_operation");
  if (shallow) matched.add("shallow_clone");
  if (statusReliable && dirtyFiles.length > 0) matched.add("git_dirty");
  if (statusReliable && dirtyFiles.length === 0 && !unborn && !detached && !midOperation) matched.add("git_clean");
  if (gitBusy && !unborn && !detached && !midOperation && !matched.has("git_dirty") && !matched.has("git_clean")) {
    matched.add("git_clean");
  }

  return buildResult({
    folder: resolvedFolder,
    matched,
    head,
    branch,
    detached,
    dirtyFiles,
    midOperation,
    otherVcs,
    syncWarning,
    identity,
    shallow,
    gitBusy,
    statusReliable: statusReliable && !gitBusy,
    onlyOsJunk,
    accessError: null,
    gitDir,
  });
}
