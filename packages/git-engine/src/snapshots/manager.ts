import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DeveloperWorktreeMutatedError,
  SnapshotGitError,
  SnapshotRefRejectedError,
  SnapshotSafetyBlockedError,
  TempIndexLocationError,
} from "./errors.js";
import { createProcessSnapshotGitRunner } from "./git-runner.js";
import { assertSafeRefComponent, isInsideDir, normalizeRelPath } from "./paths.js";
import { createDeltaSafetyScanner, filterReportToDelta } from "./safety-scan.js";
import { allocateTempIndex, defaultHarnessTmp, sweepStaleTempIndexes } from "./temp-index.js";
import {
  CHECKPOINT_COMMIT_SUBJECT,
  CHECKPOINT_REF_PREFIX,
  EMPTY_TREE_OID,
  HARNESS_KERNEL_EMAIL,
  HARNESS_KERNEL_NAME,
  SNAPSHOT_COMMIT_SUBJECT,
  SNAPSHOT_REF_PREFIX,
  ZERO_OID,
} from "./types.js";
import type {
  CheckpointCommitResult,
  CheckpointDisposition,
  CreateCheckpointWipCommitInput,
  CreateDirtyWorkSnapshotInput,
  GitSafetyScannerPort,
  ListSnapshotsInput,
  PruneRefusal,
  PruneRefusalReason,
  PruneSnapshotsInput,
  PruneSnapshotsResult,
  SafetyScanReport,
  SnapshotGitRequest,
  SnapshotGitResult,
  SnapshotGitRunner,
  SnapshotListEntry,
  SnapshotManagerOptions,
  SnapshotResult,
  WorktreeFingerprint,
} from "./types.js";

const ADD_RETRY_DELAYS_MS = [25, 50, 100, 200, 400];

interface GitContext {
  readonly repoPath: string;
  readonly developerCheckout: boolean;
  readonly consent: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function assertOid(value: string, label: string): string {
  const oid = value.trim();
  if (!/^[0-9a-f]{40}$/i.test(oid)) {
    throw new SnapshotGitError([label], 1, `expected an object id, received ${JSON.stringify(oid)}`);
  }
  return oid;
}

function trailerValue(value: string | undefined, label: string): string {
  const resolved = value && value.trim() ? value.trim() : "none";
  if (/[\r\n\0]/.test(resolved)) {
    throw new SnapshotRefRejectedError(`${label} cannot contain a newline.`);
  }
  return resolved;
}

function snapshotMessage(input: { taskId?: string; attemptId?: string; step?: string }): string {
  return [
    SNAPSHOT_COMMIT_SUBJECT,
    "",
    `Harness-Task: ${trailerValue(input.taskId, "Harness-Task")}`,
    `Harness-Attempt: ${trailerValue(input.attemptId, "Harness-Attempt")}`,
    `Harness-Step: ${trailerValue(input.step, "Harness-Step")}`,
    "",
  ].join("\n");
}

function checkpointMessage(taskId: string, attemptId: string, step: string): string {
  return [
    CHECKPOINT_COMMIT_SUBJECT,
    "",
    `Harness-Task: ${trailerValue(taskId, "Harness-Task")}`,
    `Harness-Attempt: ${trailerValue(attemptId, "Harness-Attempt")}`,
    `Harness-Step: ${trailerValue(step, "Harness-Step")}`,
    "",
  ].join("\n");
}

function changedField(before: WorktreeFingerprint, after: WorktreeFingerprint): string | null {
  if (before.indexSha256 !== after.indexSha256) return "indexSha256";
  if (before.head !== after.head) return "head";
  if (before.diffCached !== after.diffCached) return "diffCached";
  if (before.diff !== after.diff) return "diff";
  if (before.untracked !== after.untracked) return "untracked";
  if (before.status !== after.status) return "status";
  return null;
}

export function parseStatusZ(stdout: string): string[] {
  const parts = stdout.split("\0");
  const paths: string[] = [];
  let index = 0;
  while (index < parts.length) {
    const record = parts[index] ?? "";
    if (record.length < 4) {
      index += 1;
      continue;
    }
    const code = record.slice(0, 2);
    const first = normalizeRelPath(record.slice(3));
    const renamed = code.includes("R") || code.includes("C");
    if (renamed) {
      const second = normalizeRelPath(parts[index + 1] ?? "");
      if (first) paths.push(first);
      if (second) paths.push(second);
      index += 2;
      continue;
    }
    if (first) paths.push(first);
    index += 1;
  }
  return [...new Set(paths)];
}

function isTransientAddFailure(stderr: string): boolean {
  return /sharing violation|being used by another process|permission denied|eperm|ebusy|cannot access the file|unable to stat|stat failed|changed-stat|racy git|index\.lock/i.test(
    stderr,
  );
}

function isSubmoduleAddFailure(stderr: string): boolean {
  return /submodule|does not have a commit checked out|is in submodule|not a git repository/i.test(stderr);
}

function readEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "Never",
  };
  delete env.GIT_INDEX_FILE;
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  return env;
}

function indexEnvironment(indexFile: string): NodeJS.ProcessEnv {
  const env = readEnvironment();
  delete env.GIT_OPTIONAL_LOCKS;
  env.GIT_INDEX_FILE = indexFile;
  env.GIT_AUTHOR_NAME = HARNESS_KERNEL_NAME;
  env.GIT_AUTHOR_EMAIL = HARNESS_KERNEL_EMAIL;
  env.GIT_COMMITTER_NAME = HARNESS_KERNEL_NAME;
  env.GIT_COMMITTER_EMAIL = HARNESS_KERNEL_EMAIL;
  return env;
}

function identityEnvironment(): NodeJS.ProcessEnv {
  const env = readEnvironment();
  env.GIT_AUTHOR_NAME = HARNESS_KERNEL_NAME;
  env.GIT_AUTHOR_EMAIL = HARNESS_KERNEL_EMAIL;
  env.GIT_COMMITTER_NAME = HARNESS_KERNEL_NAME;
  env.GIT_COMMITTER_EMAIL = HARNESS_KERNEL_EMAIL;
  return env;
}

async function hashFile(file: string): Promise<string> {
  try {
    const data = await readFile(file);
    return createHash("sha256").update(data).digest("hex");
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : "";
    if (code === "ENOENT") return "absent";
    throw error;
  }
}

function exclusionPlan(report: SafetyScanReport, excludeFlaggedSecrets: boolean): string[] {
  const secretPaths = [
    ...new Set(report.blockedSecrets.map((item) => normalizeRelPath(item.file || item.path)).filter(Boolean)),
  ].sort();
  const largePaths = report.largeFiles.map((item) => normalizeRelPath(item.file));
  if (largePaths.length > 0 || (secretPaths.length === 0 && report.safeToCommit === false)) {
    throw new SnapshotSafetyBlockedError(report);
  }
  if (secretPaths.length > 0 && !excludeFlaggedSecrets) {
    throw new SnapshotSafetyBlockedError(report);
  }
  if (secretPaths.some((item) => item.includes("\n") || item.includes("\0"))) {
    throw new SnapshotRefRejectedError("A flagged path cannot contain a newline.");
  }
  return excludeFlaggedSecrets ? secretPaths : [];
}

function classifyPrune(
  ref: string,
  states: readonly CheckpointDisposition[],
): PruneRefusalReason | null {
  if (ref.startsWith(`${SNAPSHOT_REF_PREFIX}/`)) return null;
  if (!ref.startsWith(`${CHECKPOINT_REF_PREFIX}/`)) return "not_harness_snapshot_namespace";
  const rest = ref.slice(CHECKPOINT_REF_PREFIX.length + 1);
  const slash = rest.lastIndexOf("/");
  if (slash <= 0) return "not_harness_snapshot_namespace";
  const attemptId = rest.slice(0, slash);
  const state = states.find((item) => item.attemptId === attemptId);
  if (!state) return "checkpoint_disposition_required";
  if (state.parked) return "checkpoint_parked";
  if (!state.landed) return "checkpoint_unlanded";
  return null;
}

export class SnapshotManager {
  private readonly git: SnapshotGitRunner;
  private readonly gitBinary: string | undefined;
  private readonly options: SnapshotManagerOptions;

  constructor(options: SnapshotManagerOptions = {}) {
    this.options = options;
    this.gitBinary = options.gitBinary;
    this.git =
      options.git ??
      createProcessSnapshotGitRunner(options.gitBinary ? { gitBinary: options.gitBinary } : {});
  }

  async createDirtyWorkSnapshot(input: CreateDirtyWorkSnapshotInput): Promise<SnapshotResult> {
    const projectId = assertSafeRefComponent(input.projectId, "project id");
    const ctx = this.context(
      input.repoPath,
      input.developerCheckout ?? true,
      input.userExplicitConsentToken,
      "include-uncommitted-work",
    );
    const harnessTmp = this.harnessDirectory(input.harnessTmp);
    return this.guard(ctx, async () => {
      const headSha = await this.prepare(ctx, harnessTmp);
      const paths = await this.dirtyPaths(ctx);
      if (paths.length === 0) {
        return this.unchangedSnapshot(ctx, headSha);
      }
      const report = await this.scan(ctx.repoPath, paths);
      const excluded = exclusionPlan(report, input.excludeFlaggedSecrets ?? false);
      const treeSha = await this.writeTemporaryTree(ctx, headSha, excluded, harnessTmp);
      if (headSha) {
        const headTree = assertOid(
          await this.must(ctx, ["rev-parse", `${headSha}^{tree}`], readEnvironment(), false),
          "rev-parse",
        );
        if (treeSha === headTree) return this.unchangedSnapshot(ctx, headSha, excluded, treeSha);
      } else if (treeSha === EMPTY_TREE_OID) {
        return this.unchangedSnapshot(ctx, null, excluded, treeSha);
      }
      const commitSha = await this.commitTree(ctx, treeSha, headSha, snapshotMessage(input), harnessTmp);
      const ref = await this.publishNumberedRef(
        ctx,
        `${SNAPSHOT_REF_PREFIX}/${projectId}`,
        commitSha,
        input.snapshotNumber,
      );
      return {
        noChanges: false,
        commitSha,
        treeSha,
        ref,
        headSha,
        unborn: headSha === null,
        parentSha: headSha,
        excludedPaths: excluded,
      };
    });
  }

  async createCheckpointWipCommit(input: CreateCheckpointWipCommitInput): Promise<CheckpointCommitResult> {
    const attemptId = assertSafeRefComponent(input.attemptId, "attempt id");
    const step = assertSafeRefComponent(input.step, "step");
    const taskId = assertSafeRefComponent(input.taskId, "task id");
    const ctx = this.context(
      input.repoPath,
      input.developerCheckout ?? false,
      input.userExplicitConsentToken,
      "checkpoint-wip-commit",
    );
    const harnessTmp = this.harnessDirectory(input.harnessTmp);
    return this.guard(ctx, async () => {
      const headSha = await this.prepare(ctx, harnessTmp);
      const previous = await this.resolvePrevious(ctx, input.previousWipRef);
      const paths = await this.dirtyPaths(ctx);
      if (paths.length === 0 && !previous) {
        if (!headSha) {
          return this.reusedCheckpoint(EMPTY_TREE_OID, EMPTY_TREE_OID, null, [], EMPTY_TREE_OID);
        }
        const treeSha = assertOid(
          await this.must(ctx, ["rev-parse", `${headSha}^{tree}`], readEnvironment(), false),
          "rev-parse",
        );
        return this.reusedCheckpoint(headSha, headSha, null, [], treeSha);
      }
      const excluded =
        paths.length === 0 ? [] : exclusionPlan(await this.scan(ctx.repoPath, paths), input.excludeFlaggedSecrets ?? false);
      const treeSha = await this.writeTemporaryTree(ctx, headSha, excluded, harnessTmp);
      const previousTree = previous
        ? assertOid(
            await this.must(ctx, ["rev-parse", `${previous.sha}^{tree}`], readEnvironment(), false),
            "rev-parse",
          )
        : headSha
          ? assertOid(
              await this.must(ctx, ["rev-parse", `${headSha}^{tree}`], readEnvironment(), false),
              "rev-parse",
            )
          : null;
      if (previousTree && treeSha === previousTree) {
        const wip = previous?.ref ?? previous?.sha ?? headSha ?? treeSha;
        const commit = previous?.sha ?? headSha ?? treeSha;
        return this.reusedCheckpoint(commit, wip, previous?.sha ?? null, excluded, treeSha);
      }
      const parent = previous?.sha ?? headSha;
      const commitSha = await this.commitTree(
        ctx,
        treeSha,
        parent,
        checkpointMessage(taskId, attemptId, step),
        harnessTmp,
      );
      const ref = `${CHECKPOINT_REF_PREFIX}/${attemptId}/${step}`;
      const updated = await this.run(ctx, ["update-ref", ref, commitSha, ZERO_OID], readEnvironment(), true);
      if (updated.exitCode !== 0) {
        throw new SnapshotGitError(["update-ref", ref], updated.exitCode, updated.stderr);
      }
      return {
        reused: false,
        noChanges: false,
        commitSha,
        treeSha,
        ref,
        parentSha: parent,
        wipRef: ref,
        excludedPaths: excluded,
      };
    });
  }

  async listSnapshots(input: ListSnapshotsInput): Promise<SnapshotListEntry[]> {
    const ctx = this.context(input.repoPath, false, undefined, "list-snapshots");
    const snapshots = await this.listRefs(ctx, SNAPSHOT_REF_PREFIX);
    const checkpoints = await this.listRefs(ctx, CHECKPOINT_REF_PREFIX);
    const snapshotsWanted = input.attemptId === undefined || input.projectId !== undefined;
    const checkpointsWanted = input.projectId === undefined || input.attemptId !== undefined;
    const selected: SnapshotListEntry[] = [];
    if (snapshotsWanted) {
      const prefix = input.projectId
        ? `${SNAPSHOT_REF_PREFIX}/${assertSafeRefComponent(input.projectId, "project id")}/`
        : `${SNAPSHOT_REF_PREFIX}/`;
      selected.push(...snapshots.filter((entry) => entry.ref.startsWith(prefix)));
    }
    if (checkpointsWanted) {
      const prefix = input.attemptId
        ? `${CHECKPOINT_REF_PREFIX}/${assertSafeRefComponent(input.attemptId, "attempt id")}/`
        : `${CHECKPOINT_REF_PREFIX}/`;
      selected.push(...checkpoints.filter((entry) => entry.ref.startsWith(prefix)));
    }
    selected.sort((left, right) => left.ref.localeCompare(right.ref));
    return selected;
  }

  async pruneSnapshots(input: PruneSnapshotsInput): Promise<PruneSnapshotsResult> {
    const ctx = this.context(
      input.repoPath,
      input.developerCheckout ?? false,
      input.userExplicitConsentToken,
      "prune-retired-snapshot",
    );
    const deleted: string[] = [];
    const refused: PruneRefusal[] = [];
    const seen = new Set<string>();
    for (const ref of input.refs) {
      if (seen.has(ref)) continue;
      seen.add(ref);
      const reason = classifyPrune(ref, input.checkpointStates ?? []);
      if (reason) {
        refused.push({ ref, reason });
        continue;
      }
      const current = await this.run(
        ctx,
        ["rev-parse", "--verify", "--quiet", ref],
        readEnvironment(),
        false,
      );
      if (current.exitCode !== 0) {
        refused.push({ ref, reason: "missing" });
        continue;
      }
      const removed = await this.run(
        ctx,
        ["update-ref", "-d", ref, current.stdout.trim()],
        readEnvironment(),
        true,
      );
      if (removed.exitCode !== 0) {
        refused.push({ ref, reason: "cas_mismatch" });
        continue;
      }
      deleted.push(ref);
    }
    return { deleted, refused };
  }

  async sweepTempIndexes(harnessTmp?: string, maxAgeMs = 0): Promise<readonly string[]> {
    const dir = path.resolve(harnessTmp ?? this.options.harnessTmp ?? defaultHarnessTmp());
    return sweepStaleTempIndexes(dir, maxAgeMs);
  }

  private context(
    repoPath: string,
    developerCheckout: boolean,
    token: string | undefined,
    fallback: string,
  ): GitContext {
    return {
      repoPath: path.resolve(repoPath),
      developerCheckout,
      consent: token?.trim() ? token.trim() : fallback,
    };
  }

  private harnessDirectory(override: string | undefined): string {
    return path.resolve(override ?? this.options.harnessTmp ?? defaultHarnessTmp());
  }

  private scannerFor(repoPath: string): GitSafetyScannerPort {
    if (this.options.safetyScannerForRepo) return this.options.safetyScannerForRepo(repoPath);
    if (this.options.safetyScanner) return this.options.safetyScanner;
    return createDeltaSafetyScanner({ vaultSecrets: this.options.vaultSecrets ?? [] });
  }

  private async scan(repoPath: string, paths: readonly string[]): Promise<SafetyScanReport> {
    const scanner = this.scannerFor(repoPath);
    if (scanner.scanUncommittedDelta) {
      return scanner.scanUncommittedDelta({ repoPath, paths });
    }
    if (scanner.scanWorkingTreeForBaseline) {
      return filterReportToDelta(await scanner.scanWorkingTreeForBaseline(), paths);
    }
    const fallback = createDeltaSafetyScanner({ vaultSecrets: this.options.vaultSecrets ?? [] });
    if (!fallback.scanUncommittedDelta) {
      return { blockedSecrets: [], largeFiles: [], safeToCommit: true };
    }
    return fallback.scanUncommittedDelta({ repoPath, paths });
  }

  private async guard<T>(ctx: GitContext, action: () => Promise<T>): Promise<T> {
    const before = await this.fingerprint(ctx);
    try {
      return await action();
    } finally {
      const after = await this.fingerprint(ctx);
      const field = changedField(before, after);
      if (field) throw new DeveloperWorktreeMutatedError(field);
    }
  }

  private async prepare(ctx: GitContext, harnessTmp: string): Promise<string | null> {
    const gitDir = (
      await this.must(ctx, ["rev-parse", "--absolute-git-dir"], readEnvironment(), false)
    ).trim();
    this.assertTempLocation(ctx.repoPath, gitDir, harnessTmp);
    await mkdir(harnessTmp, { recursive: true });
    await sweepStaleTempIndexes(harnessTmp, 60_000);
    const head = await this.run(
      ctx,
      ["rev-parse", "--verify", "--quiet", "HEAD"],
      readEnvironment(),
      false,
    );
    if (head.exitCode !== 0) return null;
    return assertOid(head.stdout, "HEAD");
  }

  private assertTempLocation(repoPath: string, gitDir: string, harnessTmp: string): void {
    if (isInsideDir(harnessTmp, repoPath) || isInsideDir(harnessTmp, gitDir)) {
      throw new TempIndexLocationError(
        "GIT_INDEX_FILE must live in harnessTmp, never inside the repository or .git.",
      );
    }
  }

  private async dirtyPaths(ctx: GitContext): Promise<string[]> {
    const stdout = await this.must(
      ctx,
      ["--no-optional-locks", "status", "--porcelain=v1", "-z", "-uall"],
      readEnvironment(),
      false,
    );
    return parseStatusZ(stdout);
  }

  private async unchangedSnapshot(
    ctx: GitContext,
    headSha: string | null,
    excluded: readonly string[] = [],
    treeSha: string | null = null,
  ): Promise<SnapshotResult> {
    const resolvedTree =
      treeSha ??
      (headSha
        ? assertOid(
            await this.must(ctx, ["rev-parse", `${headSha}^{tree}`], readEnvironment(), false),
            "rev-parse",
          )
        : null);
    return {
      noChanges: true,
      commitSha: headSha,
      treeSha: resolvedTree,
      ref: null,
      headSha,
      unborn: headSha === null,
      parentSha: null,
      excludedPaths: excluded,
    };
  }

  private reusedCheckpoint(
    commitSha: string,
    wipRef: string,
    parentSha: string | null,
    excluded: readonly string[],
    treeSha?: string,
  ): CheckpointCommitResult {
    return {
      reused: true,
      noChanges: true,
      commitSha,
      treeSha: treeSha ?? commitSha,
      ref: null,
      parentSha,
      wipRef,
      excludedPaths: excluded,
    };
  }

  private async resolvePrevious(
    ctx: GitContext,
    previousWipRef: string | undefined,
  ): Promise<{ readonly ref: string; readonly sha: string } | null> {
    if (!previousWipRef) return null;
    const sha = assertOid(
      await this.must(ctx, ["rev-parse", "--verify", previousWipRef], readEnvironment(), false),
      "rev-parse",
    );
    return { ref: previousWipRef, sha };
  }

  private async writeTemporaryTree(
    ctx: GitContext,
    headSha: string | null,
    excluded: readonly string[],
    harnessTmp: string,
  ): Promise<string> {
    const gitDir = (
      await this.must(ctx, ["rev-parse", "--absolute-git-dir"], readEnvironment(), false)
    ).trim();
    const { indexFile } = allocateTempIndex(harnessTmp);
    const lockFile = `${indexFile}.lock`;
    try {
      if (headSha) {
        await this.must(ctx, ["read-tree", headSha], indexEnvironment(indexFile), true);
      } else {
        await this.must(ctx, ["read-tree", "--empty"], indexEnvironment(indexFile), true);
      }
      await this.addAll(ctx, indexFile, excluded, gitDir);
      if (excluded.length > 0) {
        await this.must(
          ctx,
          ["rm", "--cached", "--ignore-unmatch", "--", ...excluded],
          indexEnvironment(indexFile),
          true,
        );
      }
      return assertOid(
        await this.must(ctx, ["write-tree"], indexEnvironment(indexFile), true),
        "write-tree",
      );
    } finally {
      await this.unlinkOutside(indexFile, gitDir);
      await this.unlinkOutside(lockFile, gitDir);
    }
  }

  private async addAll(
    ctx: GitContext,
    indexFile: string,
    excluded: readonly string[],
    gitDir: string,
  ): Promise<void> {
    const submodules = await this.submodulePaths(ctx);
    const inactive: string[] = [];
    for (const item of submodules) {
      if (!(await this.submoduleCheckedOut(ctx.repoPath, item))) inactive.push(item);
    }
    let skipSubmodules = false;
    let attempt = 0;
    while (true) {
      const args = ["add", "-A"];
      const skipped = new Set<string>(excluded);
      for (const item of inactive) skipped.add(item);
      if (skipSubmodules) {
        for (const item of submodules) skipped.add(item);
      }
      if (skipped.size > 0) {
        args.push("--", ".");
        for (const item of skipped) args.push(`:(exclude,literal)${item}`);
      }
      const result = await this.run(ctx, args, indexEnvironment(indexFile), true);
      if (result.exitCode === 0) return;
      if (!skipSubmodules && submodules.length > 0 && isSubmoduleAddFailure(result.stderr)) {
        skipSubmodules = true;
        continue;
      }
      if (isTransientAddFailure(result.stderr) && attempt < ADD_RETRY_DELAYS_MS.length) {
        const delay = ADD_RETRY_DELAYS_MS[attempt] ?? 25;
        attempt += 1;
        await sleep(delay);
        await this.unlinkOutside(`${indexFile}.lock`, gitDir);
        continue;
      }
      throw new SnapshotGitError(args, result.exitCode, result.stderr);
    }
  }

  private async submodulePaths(ctx: GitContext): Promise<string[]> {
    const paths = new Set<string>();
    let text = "";
    try {
      text = await readFile(path.join(ctx.repoPath, ".gitmodules"), "utf8");
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String(error.code) : "";
      if (code !== "ENOENT") throw error;
    }
    for (const match of text.matchAll(/^\s*path\s*=\s*(.+)$/gm)) {
      const value = match[1]?.trim();
      if (value) paths.add(normalizeRelPath(value));
    }
    const listed = await this.run(
      ctx,
      ["--no-optional-locks", "ls-files", "-s", "-z"],
      readEnvironment(),
      false,
    );
    if (listed.exitCode === 0) {
      for (const record of listed.stdout.split("\0")) {
        if (!record.startsWith("160000 ")) continue;
        const tab = record.indexOf("\t");
        if (tab >= 0) {
          const relative = normalizeRelPath(record.slice(tab + 1));
          if (relative) paths.add(relative);
        }
      }
    }
    return [...paths];
  }

  private async submoduleCheckedOut(repoPath: string, relativePath: string): Promise<boolean> {
    const absolute = path.resolve(repoPath, relativePath);
    const relative = path.relative(repoPath, absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative)) return false;
    try {
      const info = await lstat(absolute);
      if (!info.isDirectory()) return false;
    } catch {
      return false;
    }
    try {
      const gitInfo = await lstat(path.join(absolute, ".git"));
      return gitInfo.isFile() || gitInfo.isDirectory();
    } catch {
      return false;
    }
  }

  private async commitTree(
    ctx: GitContext,
    treeSha: string,
    parentSha: string | null,
    message: string,
    harnessTmp: string,
  ): Promise<string> {
    const gitDir = (
      await this.must(ctx, ["rev-parse", "--absolute-git-dir"], readEnvironment(), false)
    ).trim();
    const { messageFile } = allocateTempIndex(harnessTmp);
    try {
      await writeFile(messageFile, message, "utf8");
      const args = parentSha
        ? ["commit-tree", treeSha, "-p", parentSha, "-F", messageFile]
        : ["commit-tree", treeSha, "-F", messageFile];
      return assertOid(await this.must(ctx, args, identityEnvironment(), true), "commit-tree");
    } finally {
      await this.unlinkOutside(messageFile, gitDir);
    }
  }

  private async publishNumberedRef(
    ctx: GitContext,
    prefix: string,
    commitSha: string,
    requested: number | undefined,
  ): Promise<string> {
    if (requested !== undefined) {
      if (!Number.isInteger(requested) || requested < 1) {
        throw new SnapshotRefRejectedError("Snapshot number must be a positive integer.");
      }
      const ref = `${prefix}/${requested}`;
      const result = await this.run(ctx, ["update-ref", ref, commitSha, ZERO_OID], readEnvironment(), true);
      if (result.exitCode !== 0) throw new SnapshotGitError(["update-ref", ref], result.exitCode, result.stderr);
      return ref;
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const number = (await this.highestRefNumber(ctx, prefix)) + 1;
      const ref = `${prefix}/${number}`;
      const result = await this.run(ctx, ["update-ref", ref, commitSha, ZERO_OID], readEnvironment(), true);
      if (result.exitCode === 0) return ref;
    }
    throw new SnapshotGitError(["update-ref", prefix], 1, "could not allocate a free snapshot ref");
  }

  private async highestRefNumber(ctx: GitContext, prefix: string): Promise<number> {
    const entries = await this.listRefs(ctx, prefix);
    let max = 0;
    for (const entry of entries) {
      if (!entry.ref.startsWith(`${prefix}/`)) continue;
      const last = entry.ref.slice(prefix.length + 1);
      if (last.includes("/")) continue;
      const value = Number(last);
      if (Number.isInteger(value) && value > max) max = value;
    }
    return max;
  }

  private async listRefs(ctx: GitContext, prefix: string): Promise<SnapshotListEntry[]> {
    const stdout = await this.must(
      ctx,
      [
        "for-each-ref",
        "--format=%(refname)%00%(objectname)%00%(committerdate:iso-strict)%00%(subject)",
        prefix,
      ],
      readEnvironment(),
      false,
    );
    const entries: SnapshotListEntry[] = [];
    for (const line of stdout.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const [ref, commitSha, committedAt, subject] = line.split("\0");
      if (!ref || !commitSha) continue;
      const parents = (
        await this.must(ctx, ["log", "-1", "--format=%P", commitSha], readEnvironment(), false)
      ).trim();
      entries.push({
        ref,
        kind: ref.startsWith(`${CHECKPOINT_REF_PREFIX}/`) ? "checkpoint" : "snapshot",
        commitSha,
        parentShas: parents ? parents.split(" ").filter((item) => item.length > 0) : [],
        committedAt: committedAt ?? "",
        subject: subject ?? "",
      });
    }
    return entries;
  }

  private async fingerprint(ctx: GitContext): Promise<WorktreeFingerprint> {
    const indexPath = path.resolve(
      ctx.repoPath,
      (await this.must(ctx, ["rev-parse", "--git-path", "index"], readEnvironment(), false)).trim(),
    );
    const indexSha256 = await hashFile(indexPath);
    const env = readEnvironment();
    const head = await this.run(ctx, ["rev-parse", "--verify", "--quiet", "HEAD"], env, false);
    const status = await this.must(
      ctx,
      ["--no-optional-locks", "status", "--porcelain=v1", "-z", "-uall"],
      env,
      false,
    );
    const diffCached = await this.must(
      ctx,
      ["--no-optional-locks", "diff", "--cached", "--raw", "-z", "--no-ext-diff", "--no-renames"],
      env,
      false,
    );
    const diff = await this.must(
      ctx,
      ["--no-optional-locks", "diff", "--raw", "-z", "--no-ext-diff", "--no-renames"],
      env,
      false,
    );
    const untracked = await this.must(
      ctx,
      ["--no-optional-locks", "ls-files", "--others", "--exclude-standard", "-z"],
      env,
      false,
    );
    const after = await hashFile(indexPath);
    if (after !== indexSha256) throw new DeveloperWorktreeMutatedError("indexSha256");
    return {
      indexSha256,
      head: head.exitCode === 0 ? head.stdout.trim() : "unborn",
      status,
      diff,
      diffCached,
      untracked,
    };
  }

  private async unlinkOutside(target: string, gitDir: string): Promise<void> {
    if (isInsideDir(target, gitDir)) {
      throw new TempIndexLocationError("Refusing to delete a path inside the Git directory.");
    }
    await rm(target, { force: true });
  }

  private async run(
    ctx: GitContext,
    args: readonly string[],
    env: NodeJS.ProcessEnv,
    mutate: boolean,
  ): Promise<SnapshotGitResult> {
    const request: SnapshotGitRequest = {
      args,
      cwd: ctx.repoPath,
      env,
      developerCheckout: ctx.developerCheckout,
      ...(mutate ? { userExplicitConsentToken: ctx.consent } : {}),
      ...(this.gitBinary ? { gitBinary: this.gitBinary } : {}),
    };
    return this.git.execGit(request);
  }

  private async must(
    ctx: GitContext,
    args: readonly string[],
    env: NodeJS.ProcessEnv,
    mutate: boolean,
  ): Promise<string> {
    const result = await this.run(ctx, args, env, mutate);
    if (result.exitCode !== 0) throw new SnapshotGitError(args, result.exitCode, result.stderr);
    return result.stdout;
  }
}
