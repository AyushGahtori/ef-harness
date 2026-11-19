import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assertConfigAllowlistSafe, copyAllowlistedConfig, resolveEnvironmentManifest } from "./config-copy.js";
import { DiskLane } from "./disk-lane.js";
import {
  BeforeSlotResetRequiredError,
  GitCommandFailedError,
  GitLfsFetchError,
  IntegrationLeaseRejectedError,
  IntegrationRefMismatchError,
  IntegrationRefMissingError,
  IntegrationWorktreeExclusivityError,
  SlotOwnershipError,
  WorktreeSlotError,
} from "./errors.js";
import {
  assertSafeBranchPiece,
  assertSafeRelativePath,
  attemptBranchName,
  cleanArgs,
  gitOk,
  gitRetry,
  latestCheckpointRef,
  parseWorktreePorcelain,
  pathExists,
  rmWithRetry,
  samePath,
} from "./git-ops.js";
import { createProcessGitRunner, type GitRunner } from "./git-runner.js";
import { hashLockfilesAtCommit } from "./lockfile.js";
import { markerMatchesProject, readSlotOwnerMarker, writeSlotOwnerMarker } from "./ownership.js";
import {
  readProjectState,
  writeProjectState,
  type ProjectState,
  type SlotRecord,
} from "./registry.js";
import { compactShortId } from "./short-id.js";
import {
  DEFAULT_RECOMMENDED_PARALLELISM,
  DEFAULT_SLOW_WORKTREE_MS,
  FAILED_SLOT_RETENTION_MS,
  WARM_DEPENDENCY_EXCLUDES,
  type AcquireMergeWorktreeRequest,
  type AcquireSlotRequest,
  type AttemptBranchState,
  type DependencySyncRequest,
  type EnsureIntegrationWorktreeRequest,
  type FastForwardIntegrationRequest,
  type FastForwardResult,
  type IntegrationAdvancedEvent,
  type IntegrationLease,
  type PruneResult,
  type PruneStaleWorktreesRequest,
  type ReconcileResult,
  type ReconcileWorktreesRequest,
  type RecoveryRecord,
  type ReleaseSlotRequest,
  type RepairWorktreesRequest,
  type RepairWorktreesResult,
  type ResetSlotRequest,
  type ResolvedEnvironmentManifest,
  type SlotExecutionPurpose,
  type SlotHandle,
  type SlotKind,
  type SparseCheckoutRequest,
  type WorktreeLogger,
} from "./types.js";

export interface WorktreeSlotManagerOptions {
  readonly wtRoot: string;
  readonly git?: GitRunner;
  readonly diskLane?: DiskLane;
  readonly clock?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly onEmptySlotCreated?: (slotPath: string) => void | Promise<void>;
  readonly onIntegrationAdvanced?: (event: IntegrationAdvancedEvent) => void | Promise<void>;
  readonly onDependencySyncRequested?: (event: DependencySyncRequest) => void | Promise<void>;
  readonly logger?: WorktreeLogger;
  readonly slowWorktreeThresholdMs?: number;
  readonly defaultRecommendedParallelism?: number;
  readonly failedSlotRetentionMs?: number;
  readonly busyAttempts?: number;
  readonly busyBaseDelayMs?: number;
  readonly userExplicitConsentToken?: string;
}

const noopLogger: WorktreeLogger = {
  warn() {
    return undefined;
  },
  info() {
    return undefined;
  },
};

interface CheckoutPlan {
  readonly baseCommit: string;
  readonly taskId: string | null;
  readonly attempt: string | null;
  readonly branch: string | null;
  readonly taskPaths: readonly string[];
  readonly sparsePaths: readonly string[];
  readonly manifest: ResolvedEnvironmentManifest;
  readonly beforeSlotReset?: (slotPath: string) => void | Promise<void>;
}

/**
 * Reusable worktree slot pool. Attempt slots live at
 * `%LOCALAPPDATA%\EFHarness\wt\<project-short-id>\<slot-id>`.
 * The persistent integration worktree is `wt\<project>\integration`.
 */
export class WorktreeSlotManager {
  private readonly wtRoot: string;
  private readonly git: GitRunner;
  private readonly lane: DiskLane;
  private readonly clock: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly onEmptySlotCreated: ((slotPath: string) => void | Promise<void>) | undefined;
  private readonly onIntegrationAdvanced: ((event: IntegrationAdvancedEvent) => void | Promise<void>) | undefined;
  private readonly onDependencySyncRequested: ((event: DependencySyncRequest) => void | Promise<void>) | undefined;
  private readonly logger: WorktreeLogger;
  private readonly slowWorktreeThresholdMs: number;
  private readonly defaultRecommendedParallelism: number;
  private readonly failedSlotRetentionMs: number;
  private readonly busyAttempts: number;
  private readonly busyBaseDelayMs: number;
  private readonly consentToken: string | undefined;

  constructor(options: WorktreeSlotManagerOptions) {
    this.wtRoot = options.wtRoot;
    this.git = options.git ?? createProcessGitRunner();
    this.lane = options.diskLane ?? new DiskLane();
    this.clock = options.clock ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.onEmptySlotCreated = options.onEmptySlotCreated;
    this.onIntegrationAdvanced = options.onIntegrationAdvanced;
    this.onDependencySyncRequested = options.onDependencySyncRequested;
    this.logger = options.logger ?? noopLogger;
    this.slowWorktreeThresholdMs = options.slowWorktreeThresholdMs ?? DEFAULT_SLOW_WORKTREE_MS;
    this.defaultRecommendedParallelism = options.defaultRecommendedParallelism ?? DEFAULT_RECOMMENDED_PARALLELISM;
    this.failedSlotRetentionMs = options.failedSlotRetentionMs ?? FAILED_SLOT_RETENTION_MS;
    this.busyAttempts = options.busyAttempts ?? 5;
    this.busyBaseDelayMs = options.busyBaseDelayMs ?? 50;
    this.consentToken = options.userExplicitConsentToken;
  }

  get diskLane(): DiskLane {
    return this.lane;
  }

  acquireSlot(request: AcquireSlotRequest): Promise<SlotHandle> {
    return this.lane.run(() => this.acquireSlotLocked(request));
  }

  resetSlotForAttempt(request: ResetSlotRequest): Promise<SlotHandle> {
    return this.lane.run(() => this.resetSlotLocked(request));
  }

  releaseSlot(request: ReleaseSlotRequest): Promise<void> {
    return this.lane.run(() => this.releaseSlotLocked(request));
  }

  acquireMergeWorktree(request: AcquireMergeWorktreeRequest): Promise<SlotHandle> {
    return this.lane.run(() => this.acquireMergeLocked(request));
  }

  ensureIntegrationWorktree(request: EnsureIntegrationWorktreeRequest): Promise<SlotHandle> {
    return this.lane.run(() => this.ensureIntegrationLocked(request));
  }

  fastForwardIntegrationWorktree(request: FastForwardIntegrationRequest): Promise<FastForwardResult> {
    return this.lane.run(() => this.fastForwardLocked(request));
  }

  repairWorktreesAfterMove(request: RepairWorktreesRequest): Promise<RepairWorktreesResult> {
    return this.lane.run(() => this.repairLocked(request));
  }

  pruneStaleWorktrees(request: PruneStaleWorktreesRequest): Promise<PruneResult> {
    return this.lane.run(() => this.pruneLocked(request));
  }

  reconcileMissingWorktrees(request: ReconcileWorktreesRequest): Promise<ReconcileResult> {
    return this.lane.run(() => this.reconcileLocked(request));
  }

  setIntegrationLease(projectId: string, mainRepoPath: string, lease: IntegrationLease): Promise<void> {
    return this.lane.run(() => this.setLeaseLocked(projectId, mainRepoPath, lease));
  }

  assertExecutionAllowed(projectId: string, mainRepoPath: string, slotPath: string, purpose: SlotExecutionPurpose): Promise<void> {
    return this.lane.run(() => this.assertExecutionLocked(projectId, mainRepoPath, slotPath, purpose));
  }

  removeOwnedSlot(projectId: string, mainRepoPath: string, slotPath: string): Promise<void> {
    return this.lane.run(async () => {
      const loaded = await this.loadState(projectId, mainRepoPath);
      await this.removeOwnedDirectory(loaded.state, slotPath);
      loaded.state.slots = loaded.state.slots.filter((slot) => !samePath(slot.slotPath, slotPath));
      await this.save(loaded.dir, loaded.state);
    });
  }

  private async acquireSlotLocked(request: AcquireSlotRequest): Promise<SlotHandle> {
    const plan = this.planAttempt(request);
    const loaded = await this.loadState(request.projectId, request.mainRepoPath);
    await this.reconcileMissing(loaded.dir, loaded.state);
    const reusableReady = await this.firstExistingFreeAttempt(loaded.state);
    if (reusableReady) {
      return this.resetRecord(loaded.dir, loaded.state, reusableReady, plan);
    }
    return this.createSlot(loaded.dir, loaded.state, {
      kind: "attempt",
      slotId: this.allocateSlotId(loaded.state, `${request.projectId}:${plan.branch ?? "slot"}`),
      purpose: null,
      plan,
      reused: false,
    });
  }

  private async firstExistingFreeAttempt(state: ProjectState): Promise<SlotRecord | undefined> {
    for (const slot of state.slots) {
      if (slot.kind === "attempt" && slot.status === "free" && (await pathExists(slot.slotPath))) {
        return slot;
      }
    }
    return undefined;
  }

  private async resetSlotLocked(request: ResetSlotRequest): Promise<SlotHandle> {
    const plan = this.planAttempt(request);
    const loaded = await this.loadState(request.projectId, request.mainRepoPath);
    const slot = loaded.state.slots.find((item) => item.slotId === request.slotId);
    if (!slot || slot.kind !== "attempt") {
      throw new WorktreeSlotError("slot_not_found", `attempt slot ${request.slotId} was not found`);
    }
    if (!(await pathExists(slot.slotPath))) {
      await this.reconcileMissing(loaded.dir, loaded.state);
    }
    const current = loaded.state.slots.find((item) => item.slotId === request.slotId);
    if (!current) throw new WorktreeSlotError("slot_not_found", `attempt slot ${request.slotId} was not found`);
    return this.resetRecord(loaded.dir, loaded.state, current, plan);
  }

  private async releaseSlotLocked(request: ReleaseSlotRequest): Promise<void> {
    const loaded = await this.loadState(request.projectId, request.mainRepoPath);
    const slot = loaded.state.slots.find((item) => item.slotId === request.slotId);
    if (!slot) throw new WorktreeSlotError("slot_not_found", `slot ${request.slotId} was not found`);
    if (slot.kind === "integration") {
      throw new WorktreeSlotError(
        "integration_worktree_persistent",
        "the integration worktree is persistent and cannot be released",
      );
    }
    if (slot.kind === "merge") {
      await this.invokeBeforeReset(request.beforeSlotReset, slot.slotPath);
      await this.removeOwnedDirectory(loaded.state, slot.slotPath);
      loaded.state.slots = loaded.state.slots.filter((item) => item.slotId !== slot.slotId);
      await this.save(loaded.dir, loaded.state);
      await this.gitPrune(loaded.state.mainRepoPath);
      return;
    }
    const now = this.clock();
    if (request.outcome === "merged") {
      slot.status = "free";
      slot.failedAt = null;
    } else {
      slot.status = request.outcome;
      slot.failedAt = now;
    }
    slot.updatedAt = now;
    await this.save(loaded.dir, loaded.state);
    await this.gitPrune(loaded.state.mainRepoPath);
  }

  private async acquireMergeLocked(request: AcquireMergeWorktreeRequest): Promise<SlotHandle> {
    assertProjectId(request.projectId);
    const commit = await this.resolveCommit(request.mainRepoPath, request.baseCommit);
    const manifest = resolveEnvironmentManifest(request.environmentManifest, request.mainRepoPath);
    assertConfigAllowlistSafe(manifest.allowlistedConfigFiles, manifest.vaultNames);
    const sparsePaths = sparsePathList(request.sparse);
    const loaded = await this.loadState(request.projectId, request.mainRepoPath);
    return this.createSlot(loaded.dir, loaded.state, {
      kind: "merge",
      slotId: this.allocateSlotId(loaded.state, `${request.projectId}:merge:${request.purpose}:${commit}`),
      purpose: request.purpose,
      reused: false,
      plan: {
        baseCommit: commit,
        taskId: null,
        attempt: null,
        branch: null,
        taskPaths: request.taskPaths ?? [],
        sparsePaths,
        manifest,
      },
    });
  }

  private async ensureIntegrationLocked(request: EnsureIntegrationWorktreeRequest): Promise<SlotHandle> {
    assertProjectId(request.projectId);
    const loaded = await this.loadState(request.projectId, request.mainRepoPath);
    await this.reconcileMissing(loaded.dir, loaded.state);
    const existing = loaded.state.slots.find((slot) => slot.kind === "integration");
    if (existing && (await pathExists(existing.slotPath))) {
      const head = await gitOk(this.git, ["rev-parse", "HEAD"], existing.slotPath, this.consentToken);
      return this.toHandle(loaded.state, existing, {
        reused: true,
        nodeModulesPreserved: false,
        lockfileChanged: false,
        dependencySyncRequested: false,
        recommendSparseCheckout: false,
        recommendedParallelism: this.defaultRecommendedParallelism,
        worktreeAddDurationMs: 0,
        attemptBranchState: "not-applicable",
        recreatedFromCheckpoint: null,
        headCommit: head.stdout.trim(),
      });
    }
    const sha = await this.ensureIntegrationRef(request.mainRepoPath, request.baseCommit);
    return this.createSlot(loaded.dir, loaded.state, {
      kind: "integration",
      slotId: "integration",
      purpose: "app-preview",
      reused: false,
      plan: {
        baseCommit: sha,
        taskId: null,
        attempt: null,
        branch: null,
        taskPaths: [],
        sparsePaths: [],
        manifest: resolveEnvironmentManifest(undefined, request.mainRepoPath),
      },
    });
  }

  private async fastForwardLocked(request: FastForwardIntegrationRequest): Promise<FastForwardResult> {
    const loaded = await this.loadState(request.projectId, request.mainRepoPath);
    this.assertLease(loaded.state, request.lease);
    const slot = loaded.state.slots.find((item) => item.kind === "integration");
    if (!slot || !(await pathExists(slot.slotPath))) {
      throw new WorktreeSlotError("integration_worktree_missing", "integration worktree does not exist");
    }
    const requested = (
      await gitOk(this.git, ["rev-parse", "--verify", `${request.newSha}^{commit}`], loaded.state.mainRepoPath, this.consentToken)
    ).stdout.trim();
    const refSha = (
      await gitOk(
        this.git,
        ["rev-parse", "--verify", "refs/heads/harness/integration"],
        loaded.state.mainRepoPath,
        this.consentToken,
      )
    ).stdout.trim();
    if (requested !== refSha) throw new IntegrationRefMismatchError(requested, refSha);
    const status = await gitOk(this.git, ["status", "--porcelain"], slot.slotPath, this.consentToken);
    const dirtyBefore = status.stdout.trim().length > 0;
    if (dirtyBefore) {
      this.logger.warn({
        code: "integration_worktree_dirty",
        message: "integration worktree had unexpected dirty files before fast-forward; resetting it clean",
        details: { slotPath: slot.slotPath, status: status.stdout.trim().slice(0, 500) },
      });
    }
    const previousSha = (await gitOk(this.git, ["rev-parse", "HEAD"], slot.slotPath, this.consentToken)).stdout.trim();
    const oldHash = slot.lockfileHash ?? (await hashLockfilesAtCommit(this.git, loaded.state.mainRepoPath, slot.baseCommit, this.consentToken));
    const newHash = await hashLockfilesAtCommit(this.git, loaded.state.mainRepoPath, requested, this.consentToken);
    const lockfileChanged = oldHash !== newHash;
    await gitRetry(
      this.git,
      ["checkout", "--force", "--detach", requested],
      slot.slotPath,
      this.consentToken,
      this.sleep,
      this.busyAttempts,
      this.busyBaseDelayMs,
    );
    if (lockfileChanged) await this.wipeWarmDependencies(slot.slotPath);
    await gitRetry(
      this.git,
      cleanArgs(slot.preserveIgnored),
      slot.slotPath,
      this.consentToken,
      this.sleep,
      this.busyAttempts,
      this.busyBaseDelayMs,
    );
    await this.ensureSlotMarker(loaded.state, slot);
    slot.baseCommit = requested;
    slot.lockfileHash = newHash;
    slot.updatedAt = this.clock();
    await this.save(loaded.dir, loaded.state);
    if (lockfileChanged) {
      await this.onDependencySyncRequested?.({
        projectId: request.projectId,
        slotPath: slot.slotPath,
        reason: "lockfile_changed",
        oldHash,
        newHash,
      });
    }
    const event: IntegrationAdvancedEvent = {
      type: "integration_worktree_advanced",
      projectId: request.projectId,
      slotPath: slot.slotPath,
      previousSha,
      newSha: requested,
      restartPreview: true,
    };
    await this.onIntegrationAdvanced?.(event);
    return {
      slotPath: slot.slotPath,
      previousSha,
      newSha: requested,
      dirtyBefore,
      restartedPreview: true,
    };
  }

  private async repairLocked(request: RepairWorktreesRequest): Promise<RepairWorktreesResult> {
    const loaded = await this.loadState(request.projectId, request.mainRepoPath, { acceptMovedRepo: true });
    const mainRepoPath = path.resolve(request.mainRepoPath);
    const relocated = await this.relocateSlotsUnderProjectDir(loaded.dir, loaded.state);
    for (const slot of loaded.state.slots) {
      if (!relocated.has(slot.slotId) || !(await pathExists(slot.slotPath))) continue;
      await this.repairMovedSlotLink(mainRepoPath, slot.slotPath);
    }
    await gitOk(this.git, ["worktree", "repair"], mainRepoPath, this.consentToken);
    const repairedSlots: { slotId: string; slotPath: string; headCommit: string }[] = [];
    for (const slot of loaded.state.slots) {
      if (!(await pathExists(slot.slotPath))) continue;
      let head = await this.git.execGit(["rev-parse", "HEAD"], { cwd: slot.slotPath, ...(this.consentToken !== undefined ? { userExplicitConsentToken: this.consentToken } : {}) });
      if (head.exitCode !== 0) {
        await gitOk(this.git, ["worktree", "repair"], slot.slotPath, this.consentToken);
        head = await gitOk(this.git, ["rev-parse", "HEAD"], slot.slotPath, this.consentToken);
      }
      const headCommit = head.stdout.trim();
      repairedSlots.push({ slotId: slot.slotId, slotPath: slot.slotPath, headCommit });
    }
    loaded.state.mainRepoPath = mainRepoPath;
    await this.save(loaded.dir, loaded.state);
    return { mainRepoPath, repairedSlots };
  }

  private async pruneLocked(request: PruneStaleWorktreesRequest): Promise<PruneResult> {
    const loaded = await this.loadState(request.projectId, request.mainRepoPath);
    const now = this.clock();
    const recycledSlotIds: string[] = [];
    for (const slot of loaded.state.slots) {
      if ((slot.status === "failed" || slot.status === "abandoned") && slot.failedAt !== null) {
        if (now - slot.failedAt >= this.failedSlotRetentionMs) {
          slot.status = "free";
          slot.failedAt = null;
          slot.updatedAt = now;
          recycledSlotIds.push(slot.slotId);
        }
      }
    }
    await this.save(loaded.dir, loaded.state);
    await this.gitPrune(loaded.state.mainRepoPath);
    const recovered = await this.reconcileMissing(loaded.dir, loaded.state);
    return { recycledSlotIds, recovered };
  }

  private async reconcileLocked(request: ReconcileWorktreesRequest): Promise<ReconcileResult> {
    const loaded = await this.loadState(request.projectId, request.mainRepoPath);
    const recovered = await this.reconcileMissing(loaded.dir, loaded.state);
    return { recovered };
  }

  private async setLeaseLocked(projectId: string, mainRepoPath: string, lease: IntegrationLease): Promise<void> {
    if (!lease.holderId || !Number.isInteger(lease.epoch) || lease.epoch < 1) {
      throw new IntegrationLeaseRejectedError("unauthorized", "integration lease holder and epoch must be present");
    }
    const loaded = await this.loadState(projectId, mainRepoPath);
    loaded.state.integrationLease = { holderId: lease.holderId, epoch: lease.epoch };
    await this.save(loaded.dir, loaded.state);
  }

  private async assertExecutionLocked(
    projectId: string,
    mainRepoPath: string,
    slotPath: string,
    purpose: SlotExecutionPurpose,
  ): Promise<void> {
    const loaded = await this.loadState(projectId, mainRepoPath);
    const slot = loaded.state.slots.find((item) => samePath(item.slotPath, slotPath));
    if (!slot) throw new WorktreeSlotError("unknown_slot", `no harness slot is registered at ${slotPath}`);
    if (slot.kind === "integration" && (purpose === "worker" || purpose === "merge-candidate")) {
      throw new IntegrationWorktreeExclusivityError(purpose);
    }
  }

  private planAttempt(request: AcquireSlotRequest | ResetSlotRequest): CheckoutPlan {
    assertProjectId(request.projectId);
    assertSafeBranchPiece(request.taskId, "taskId");
    const attempt = String(request.attempt);
    assertSafeBranchPiece(attempt, "attempt");
    const manifest = resolveEnvironmentManifest(request.environmentManifest, request.mainRepoPath);
    assertConfigAllowlistSafe(manifest.allowlistedConfigFiles, manifest.vaultNames);
    for (const taskPath of request.taskPaths ?? []) assertSafeRelativePath(taskPath, "task path");
    const sparsePaths = sparsePathList(request.sparse);
    const plan: CheckoutPlan = {
      baseCommit: request.baseCommit,
      taskId: request.taskId,
      attempt,
      branch: attemptBranchName(request.taskId, attempt),
      taskPaths: request.taskPaths ?? [],
      sparsePaths,
      manifest,
    };
    if (request.beforeSlotReset) return { ...plan, beforeSlotReset: request.beforeSlotReset };
    return plan;
  }

  private async createSlot(
    projectDir: string,
    state: ProjectState,
    input: { kind: SlotKind; slotId: string; purpose: string | null; plan: CheckoutPlan; reused: boolean },
  ): Promise<SlotHandle> {
    const slotPath = path.resolve(projectDir, input.slotId);
    const commit = await this.resolveCommit(state.mainRepoPath, input.plan.baseCommit);
    let added = false;
    try {
      await this.prepareEmptySlot(slotPath);
      const started = performance.now();
      await gitRetry(
        this.git,
        ["worktree", "add", "--detach", slotPath, commit],
        state.mainRepoPath,
        this.consentToken,
        this.sleep,
        this.busyAttempts,
        this.busyBaseDelayMs,
      );
      const worktreeAddDurationMs = performance.now() - started;
      added = true;
      await writeSlotOwnerMarker(slotPath, {
        v: 1,
        projectId: state.projectId,
        slotId: input.slotId,
        kind: input.kind,
      });
      const now = this.clock();
      const record: SlotRecord = {
        slotId: input.slotId,
        kind: input.kind,
        slotPath,
        status: "active",
        taskId: input.plan.taskId,
        attempt: input.plan.attempt,
        branch: input.plan.branch,
        baseCommit: commit,
        lockfileHash: null,
        failedAt: null,
        purpose: input.purpose,
        taskPaths: [...input.plan.taskPaths],
        sparsePaths: [...input.plan.sparsePaths],
        preserveIgnored: [...input.plan.manifest.preserveIgnored],
        allowlistedConfigFiles: [...input.plan.manifest.allowlistedConfigFiles],
        vaultNames: [...input.plan.manifest.vaultNames],
        configSourceRoot: input.plan.manifest.sourceRoot,
        createdAt: now,
        updatedAt: now,
      };
      state.slots.push(record);
      const finished = await this.applyCheckoutFeatures(state, record, input.plan, false);
      record.baseCommit = commit;
      record.lockfileHash = finished.lockfileHash;
      record.branch = input.plan.branch;
      record.updatedAt = this.clock();
      await this.save(projectDir, state);
      const recommendSparseCheckout = worktreeAddDurationMs > this.slowWorktreeThresholdMs;
      return this.toHandle(state, record, {
        reused: false,
        nodeModulesPreserved: false,
        lockfileChanged: false,
        dependencySyncRequested: false,
        recommendSparseCheckout,
        recommendedParallelism: recommendSparseCheckout
          ? Math.max(1, Math.floor(this.defaultRecommendedParallelism / 2))
          : this.defaultRecommendedParallelism,
        worktreeAddDurationMs,
        attemptBranchState: finished.attemptBranchState,
        recreatedFromCheckpoint: null,
        headCommit: finished.headCommit,
      });
    } catch (error) {
      state.slots = state.slots.filter((slot) => !samePath(slot.slotPath, slotPath));
      if (added) {
        await this.git.execGit(["worktree", "remove", "--force", slotPath], {
          cwd: state.mainRepoPath,
          ...(this.consentToken !== undefined ? { userExplicitConsentToken: this.consentToken } : {}),
        });
      } else if (await pathExists(slotPath)) {
        const entries = await fs.readdir(slotPath);
        if (entries.length === 0) await fs.rmdir(slotPath);
      }
      throw error;
    }
  }

  private async resetRecord(projectDir: string, state: ProjectState, slot: SlotRecord, plan: CheckoutPlan): Promise<SlotHandle> {
    if (!(await pathExists(slot.slotPath))) {
      throw new WorktreeSlotError("slot_missing", `slot directory ${slot.slotPath} is missing`);
    }
    await this.invokeBeforeReset(plan.beforeSlotReset, slot.slotPath);
    const commit = await this.resolveCommit(state.mainRepoPath, plan.baseCommit);
    const oldHash = slot.lockfileHash ?? (await hashLockfilesAtCommit(this.git, state.mainRepoPath, slot.baseCommit, this.consentToken));
    const newHash = await hashLockfilesAtCommit(this.git, state.mainRepoPath, commit, this.consentToken);
    const lockfileChanged = oldHash !== newHash;
    await gitRetry(
      this.git,
      ["checkout", "--force", "--detach", commit],
      slot.slotPath,
      this.consentToken,
      this.sleep,
      this.busyAttempts,
      this.busyBaseDelayMs,
    );
    if (lockfileChanged) await this.wipeWarmDependencies(slot.slotPath);
    await gitRetry(
      this.git,
      cleanArgs(plan.manifest.preserveIgnored),
      slot.slotPath,
      this.consentToken,
      this.sleep,
      this.busyAttempts,
      this.busyBaseDelayMs,
    );
    slot.taskId = plan.taskId;
    slot.attempt = plan.attempt;
    slot.branch = plan.branch;
    slot.baseCommit = commit;
    slot.status = "active";
    slot.failedAt = null;
    slot.taskPaths = [...plan.taskPaths];
    slot.sparsePaths = [...plan.sparsePaths];
    slot.preserveIgnored = [...plan.manifest.preserveIgnored];
    slot.allowlistedConfigFiles = [...plan.manifest.allowlistedConfigFiles];
    slot.vaultNames = [...plan.manifest.vaultNames];
    slot.configSourceRoot = plan.manifest.sourceRoot;
    slot.updatedAt = this.clock();
    const finished = await this.applyCheckoutFeatures(state, slot, plan, lockfileChanged);
    slot.lockfileHash = finished.lockfileHash;
    await this.save(projectDir, state);
    if (lockfileChanged) {
      await this.onDependencySyncRequested?.({
        projectId: state.projectId,
        slotPath: slot.slotPath,
        reason: "lockfile_changed",
        oldHash,
        newHash,
      });
    }
    return this.toHandle(state, slot, {
      reused: true,
      nodeModulesPreserved: !lockfileChanged,
      lockfileChanged,
      dependencySyncRequested: lockfileChanged,
      recommendSparseCheckout: false,
      recommendedParallelism: this.defaultRecommendedParallelism,
      worktreeAddDurationMs: 0,
      attemptBranchState: finished.attemptBranchState,
      recreatedFromCheckpoint: null,
      headCommit: finished.headCommit,
    });
  }

  private async applyCheckoutFeatures(
    state: ProjectState,
    slot: SlotRecord,
    plan: CheckoutPlan,
    lockfileChanged: boolean,
  ): Promise<{ headCommit: string; lockfileHash: string; attemptBranchState: AttemptBranchState }> {
    const attemptBranchState =
      slot.kind === "attempt" && plan.branch
        ? await this.ensureAttemptBranch(state, slot.slotPath, plan.branch, slot.slotId)
        : "not-applicable";
    if (await this.commitHasPath(state.mainRepoPath, slot.baseCommit, ".gitmodules")) {
      await gitRetry(
        this.git,
        ["-c", "protocol.file.allow=always", "submodule", "update", "--init", "--reference", state.mainRepoPath],
        slot.slotPath,
        this.consentToken,
        this.sleep,
        this.busyAttempts,
        this.busyBaseDelayMs,
      );
    }
    await this.fetchMatchingLfs(state.mainRepoPath, slot.slotPath, slot.baseCommit, plan.taskPaths);
    if (plan.sparsePaths.length > 0) {
      await this.applySparseCheckout(slot.slotPath, plan.sparsePaths);
    }
    if (plan.manifest.allowlistedConfigFiles.length > 0 && plan.manifest.sourceRoot) {
      await copyAllowlistedConfig(plan.manifest.sourceRoot, slot.slotPath, plan.manifest.allowlistedConfigFiles);
    }
    const headCommit = (await gitOk(this.git, ["rev-parse", "HEAD"], slot.slotPath, this.consentToken)).stdout.trim();
    const lockfileHash = lockfileChanged
      ? await hashLockfilesAtCommit(this.git, state.mainRepoPath, slot.baseCommit, this.consentToken)
      : (slot.lockfileHash ?? (await hashLockfilesAtCommit(this.git, state.mainRepoPath, slot.baseCommit, this.consentToken)));
    await this.ensureSlotMarker(state, slot);
    return { headCommit, lockfileHash, attemptBranchState };
  }

  private async ensureSlotMarker(state: ProjectState, slot: Pick<SlotRecord, "slotId" | "slotPath" | "kind">): Promise<void> {
    await writeSlotOwnerMarker(slot.slotPath, {
      v: 1,
      projectId: state.projectId,
      slotId: slot.slotId,
      kind: slot.kind,
    });
  }

  /**
   * A moved harness data folder keeps the same `<short-id>/<slot-id>` layout under the
   * manager's current wtRoot. Point registry entries at that directory, then `git worktree repair`
   * reconnects the main repo. Directories without this project's marker or a worktree `.git` file
   * are left untouched.
   */
  private async relocateSlotsUnderProjectDir(projectDir: string, state: ProjectState): Promise<Set<string>> {
    const relocated = new Set<string>();
    const root = path.resolve(projectDir);
    for (const slot of state.slots) {
      if (await pathExists(slot.slotPath)) continue;
      const candidate = path.resolve(root, slot.slotId);
      const relative = path.relative(root, candidate);
      if (relative.length === 0 || relative.startsWith("..") || path.isAbsolute(relative)) continue;
      if (!(await pathExists(candidate))) continue;
      const marker = await readSlotOwnerMarker(candidate);
      if (marker) {
        if (!markerMatchesProject(marker, state.projectId) || marker.slotId !== slot.slotId || marker.kind !== slot.kind) {
          continue;
        }
      } else if (!(await pathExists(path.join(candidate, ".git")))) {
        continue;
      }
      slot.slotPath = candidate;
      await this.ensureSlotMarker(state, slot);
      relocated.add(slot.slotId);
    }
    return relocated;
  }

  private async repairMovedSlotLink(mainRepoPath: string, slotPath: string): Promise<void> {
    const consent = this.consentToken !== undefined ? { userExplicitConsentToken: this.consentToken } : {};
    await this.git.execGit(["worktree", "repair"], { cwd: slotPath, ...consent });
    await this.git.execGit(["worktree", "repair", slotPath], { cwd: mainRepoPath, ...consent });
  }

  private async prepareEmptySlot(slotPath: string): Promise<void> {
    if (await pathExists(slotPath)) {
      const entries = await fs.readdir(slotPath);
      if (entries.length > 0) {
        throw new WorktreeSlotError("slot_path_not_empty", `${slotPath} already exists and is not an empty slot`);
      }
    } else {
      await fs.mkdir(slotPath, { recursive: true });
    }
    await this.onEmptySlotCreated?.(slotPath);
    const afterHook = await fs.readdir(slotPath);
    if (afterHook.length > 0) {
      throw new WorktreeSlotError(
        "empty_slot_hook_left_files",
        "onEmptySlotCreated must not create files; git worktree add requires an empty directory",
      );
    }
  }

  private async ensureAttemptBranch(
    state: ProjectState,
    slotPath: string,
    branch: string,
    slotId: string,
  ): Promise<AttemptBranchState> {
    const checkedOutAt = await this.branchCheckoutPath(state.mainRepoPath, branch);
    if (checkedOutAt && !samePath(checkedOutAt, slotPath)) return "left-existing";
    const ownedElsewhere = state.slots.some(
      (slot) =>
        slot.slotId !== slotId &&
        slot.branch === branch &&
        (slot.status === "active" || slot.status === "failed" || slot.status === "abandoned"),
    );
    if (ownedElsewhere) return "left-existing";
    const exists = await this.refExists(state.mainRepoPath, `refs/heads/${branch}`);
    if (!exists) {
      await gitOk(this.git, ["branch", branch, "HEAD"], slotPath, this.consentToken);
      return "created";
    }
    await gitOk(this.git, ["branch", "-f", branch, "HEAD"], slotPath, this.consentToken);
    return "updated";
  }

  private async reconcileMissing(projectDir: string, state: ProjectState): Promise<RecoveryRecord[]> {
    const recovered: RecoveryRecord[] = [];
    const snapshot = [...state.slots];
    for (const slot of snapshot) {
      if (await pathExists(slot.slotPath)) {
        const marker = await readSlotOwnerMarker(slot.slotPath);
        if (!marker) {
          await writeSlotOwnerMarker(slot.slotPath, {
            v: 1,
            projectId: state.projectId,
            slotId: slot.slotId,
            kind: slot.kind,
          });
        }
        continue;
      }
      if (slot.status === "free") {
        state.slots = state.slots.filter((item) => item.slotId !== slot.slotId);
        continue;
      }
      await this.gitPrune(state.mainRepoPath);
      recovered.push(await this.recreateMissingSlot(state, slot));
    }
    await this.save(projectDir, state);
    return recovered;
  }

  private async recreateMissingSlot(state: ProjectState, slot: SlotRecord): Promise<RecoveryRecord> {
    let checkpointRef: string | null = null;
    let checkpointSha: string | null = null;
    let commit = slot.baseCommit;
    if (slot.kind === "integration") {
      const ref = await this.git.execGit(["rev-parse", "--verify", "refs/heads/harness/integration"], {
        cwd: state.mainRepoPath,
        ...(this.consentToken !== undefined ? { userExplicitConsentToken: this.consentToken } : {}),
      });
      if (ref.exitCode === 0) commit = ref.stdout.trim();
    } else if (slot.taskId) {
      const listed = await this.git.execGit(
        ["for-each-ref", "--format=%(objectname) %(refname)", `refs/harness/checkpoints/${slot.taskId}`],
        {
          cwd: state.mainRepoPath,
          ...(this.consentToken !== undefined ? { userExplicitConsentToken: this.consentToken } : {}),
        },
      );
      if (listed.exitCode === 0) {
        const latest = latestCheckpointRef(listed.stdout, slot.taskId);
        if (latest) {
          checkpointRef = latest.ref;
          checkpointSha = latest.sha;
          commit = latest.sha;
        }
      }
    }
    await this.prepareEmptySlot(slot.slotPath);
    await gitRetry(
      this.git,
      ["worktree", "add", "--detach", slot.slotPath, commit],
      state.mainRepoPath,
      this.consentToken,
      this.sleep,
      this.busyAttempts,
      this.busyBaseDelayMs,
    );
    await writeSlotOwnerMarker(slot.slotPath, {
      v: 1,
      projectId: state.projectId,
      slotId: slot.slotId,
      kind: slot.kind,
    });
    slot.baseCommit = commit;
    slot.updatedAt = this.clock();
    if (slot.sparsePaths.length > 0) await this.applySparseCheckout(slot.slotPath, slot.sparsePaths);
    if (await this.commitHasPath(state.mainRepoPath, commit, ".gitmodules")) {
      await gitOk(
        this.git,
        ["-c", "protocol.file.allow=always", "submodule", "update", "--init", "--reference", state.mainRepoPath],
        slot.slotPath,
        this.consentToken,
      );
    }
    await this.fetchMatchingLfs(state.mainRepoPath, slot.slotPath, commit, slot.taskPaths);
    await this.ensureSlotMarker(state, slot);
    const headCommit = (await gitOk(this.git, ["rev-parse", "HEAD"], slot.slotPath, this.consentToken)).stdout.trim();
    this.logger.info({
      code: "worktree_fenced_and_recreated",
      message: "missing worktree slot was recreated from its checkpoint ref",
      details: { slotId: slot.slotId, checkpointRef, checkpointSha, headCommit },
    });
    return {
      slotId: slot.slotId,
      slotPath: slot.slotPath,
      action: "fence_and_recreate",
      checkpointRef,
      checkpointSha,
      headCommit,
    };
  }

  private async applySparseCheckout(slotPath: string, sparsePaths: readonly string[]): Promise<void> {
    const init = await this.git.execGit(["sparse-checkout", "init", "--cone"], {
      cwd: slotPath,
      ...(this.consentToken !== undefined ? { userExplicitConsentToken: this.consentToken } : {}),
    });
    if (init.exitCode !== 0 && !/already|initialized/i.test(`${init.stderr}\n${init.stdout}`)) {
      throw new GitCommandFailedError(["sparse-checkout", "init", "--cone"], init);
    }
    await gitOk(this.git, ["sparse-checkout", "set", ...sparsePaths], slotPath, this.consentToken);
  }

  private async fetchMatchingLfs(
    mainRepoPath: string,
    slotPath: string,
    commit: string,
    taskPaths: readonly string[],
  ): Promise<void> {
    if (!(await this.attributesUseLfs(mainRepoPath, commit))) return;
    if (taskPaths.length === 0) return;
    const include = taskPaths.join(",");
    const fetched = await this.git.execGit(["lfs", "fetch", `--include=${include}`], {
      cwd: slotPath,
      ...(this.consentToken !== undefined ? { userExplicitConsentToken: this.consentToken } : {}),
    });
    if (fetched.exitCode !== 0) {
      throw new GitLfsFetchError(fetched.stderr.trim() || fetched.stdout.trim() || "git lfs fetch failed");
    }
  }

  private async attributesUseLfs(mainRepoPath: string, commit: string): Promise<boolean> {
    const blob = await this.git.execGit(["cat-file", "blob", `${commit}:.gitattributes`], {
      cwd: mainRepoPath,
      ...(this.consentToken !== undefined ? { userExplicitConsentToken: this.consentToken } : {}),
    });
    if (blob.exitCode !== 0) return false;
    return /(^|\n)[^\n]*filter=lfs/.test(blob.stdout);
  }

  private async wipeWarmDependencies(slotPath: string): Promise<void> {
    for (const name of WARM_DEPENDENCY_EXCLUDES) {
      await rmWithRetry(path.join(slotPath, name), this.sleep, this.busyAttempts, this.busyBaseDelayMs);
    }
  }

  private async invokeBeforeReset(
    hook: ((slotPath: string) => void | Promise<void>) | undefined,
    slotPath: string,
  ): Promise<void> {
    if (!hook) throw new BeforeSlotResetRequiredError();
    await hook(slotPath);
  }

  private async removeOwnedDirectory(state: ProjectState, slotPath: string): Promise<void> {
    const marker = await readSlotOwnerMarker(slotPath);
    if (!markerMatchesProject(marker, state.projectId) || marker.kind === "project-root") {
      throw new SlotOwnershipError(slotPath);
    }
    const removed = await this.git.execGit(["worktree", "remove", "--force", slotPath], {
      cwd: state.mainRepoPath,
      ...(this.consentToken !== undefined ? { userExplicitConsentToken: this.consentToken } : {}),
    });
    if (removed.exitCode !== 0 && (await pathExists(slotPath))) {
      const again = await readSlotOwnerMarker(slotPath);
      if (!markerMatchesProject(again, state.projectId) || again.kind === "project-root") {
        throw new SlotOwnershipError(slotPath);
      }
      await rmWithRetry(slotPath, this.sleep, this.busyAttempts, this.busyBaseDelayMs);
      return;
    }
    if (removed.exitCode !== 0) throw new GitCommandFailedError(["worktree", "remove", "--force", slotPath], removed);
  }

  private async gitPrune(mainRepoPath: string): Promise<void> {
    await gitOk(this.git, ["worktree", "prune"], mainRepoPath, this.consentToken);
  }

  private async ensureIntegrationRef(mainRepoPath: string, baseCommit: string | undefined): Promise<string> {
    const existing = await this.git.execGit(["rev-parse", "--verify", "refs/heads/harness/integration"], {
      cwd: mainRepoPath,
      ...(this.consentToken !== undefined ? { userExplicitConsentToken: this.consentToken } : {}),
    });
    if (existing.exitCode === 0) return existing.stdout.trim();
    if (!baseCommit) throw new IntegrationRefMissingError();
    const sha = await this.resolveCommit(mainRepoPath, baseCommit);
    await gitOk(this.git, ["update-ref", "refs/heads/harness/integration", sha], mainRepoPath, this.consentToken);
    return sha;
  }

  private assertLease(state: ProjectState, proof: FastForwardIntegrationRequest["lease"]): void {
    if (!state.integrationLease) {
      throw new IntegrationLeaseRejectedError("missing_lease", "no integration lease is held for this project");
    }
    if (proof.role !== "project-merge-queue" || proof.holderId !== state.integrationLease.holderId) {
      throw new IntegrationLeaseRejectedError("unauthorized", "only the project merge queue holding the integration lease may fast-forward it");
    }
    if (!Number.isInteger(proof.epoch) || proof.epoch !== state.integrationLease.epoch) {
      throw new IntegrationLeaseRejectedError("stale_epoch", "integration lease epoch is stale");
    }
  }

  private async resolveCommit(mainRepoPath: string, commit: string): Promise<string> {
    const result = await gitOk(this.git, ["rev-parse", "--verify", `${commit}^{commit}`], mainRepoPath, this.consentToken);
    return result.stdout.trim();
  }

  private async commitHasPath(mainRepoPath: string, commit: string, file: string): Promise<boolean> {
    const result = await this.git.execGit(["cat-file", "-e", `${commit}:${file}`], {
      cwd: mainRepoPath,
      ...(this.consentToken !== undefined ? { userExplicitConsentToken: this.consentToken } : {}),
    });
    return result.exitCode === 0;
  }

  private async refExists(mainRepoPath: string, ref: string): Promise<boolean> {
    const result = await this.git.execGit(["show-ref", "--verify", "--quiet", ref], {
      cwd: mainRepoPath,
      ...(this.consentToken !== undefined ? { userExplicitConsentToken: this.consentToken } : {}),
    });
    return result.exitCode === 0;
  }

  private async branchCheckoutPath(mainRepoPath: string, branch: string): Promise<string | null> {
    const listed = await gitOk(this.git, ["worktree", "list", "--porcelain"], mainRepoPath, this.consentToken);
    const target = `refs/heads/${branch}`;
    for (const item of parseWorktreePorcelain(listed.stdout)) {
      if (item.branch === target) return item.path;
    }
    return null;
  }

  private allocateSlotId(state: ProjectState, seed: string): string {
    const used = new Set(state.slots.map((slot) => slot.slotId));
    for (let index = 0; index < 1000; index += 1) {
      const id = compactShortId(`${seed}#${index}`);
      if (!used.has(id)) return id;
    }
    throw new WorktreeSlotError("short_id_exhausted", "could not allocate a 6-character slot id");
  }

  private async loadState(
    projectId: string,
    mainRepoPath: string,
    options: { acceptMovedRepo?: boolean } = {},
  ): Promise<{ dir: string; state: ProjectState }> {
    assertProjectId(projectId);
    const resolvedRepo = path.resolve(mainRepoPath);
    await gitOk(this.git, ["rev-parse", "--git-dir"], resolvedRepo, this.consentToken);
    const located = await this.resolveProjectDir(projectId);
    let state = await readProjectState(located.dir);
    if (!state) {
      await fs.mkdir(located.dir, { recursive: true });
      await writeSlotOwnerMarker(located.dir, { v: 1, projectId, slotId: null, kind: "project-root" });
      state = {
        projectId,
        projectShortId: located.shortId,
        mainRepoPath: resolvedRepo,
        integrationLease: null,
        slots: [],
      };
      await this.save(located.dir, state);
      return { dir: located.dir, state };
    }
    if (!samePath(state.mainRepoPath, resolvedRepo)) {
      if (options.acceptMovedRepo) {
        state.mainRepoPath = resolvedRepo;
      } else if (!(await pathExists(state.mainRepoPath))) {
        throw new WorktreeSlotError(
          "main_repo_moved",
          "the main repo path changed; call repairWorktreesAfterMove before using the relocated repository",
        );
      } else {
        throw new WorktreeSlotError("main_repo_path_mismatch", "mainRepoPath does not match the registered repository");
      }
    }
    return { dir: located.dir, state };
  }

  private async resolveProjectDir(projectId: string): Promise<{ shortId: string; dir: string }> {
    for (let index = 0; index < 32; index += 1) {
      const shortId = compactShortId(index === 0 ? projectId : `${projectId}#${index}`);
      const dir = path.join(this.wtRoot, shortId);
      if (!(await pathExists(dir))) return { shortId, dir };
      const marker = await readSlotOwnerMarker(dir);
      if (marker?.projectId === projectId) return { shortId, dir };
      const state = await readProjectState(dir);
      if (state?.projectId === projectId) return { shortId, dir };
    }
    throw new WorktreeSlotError("short_id_exhausted", `could not allocate a 6-character id for ${projectId}`);
  }

  private async save(projectDir: string, state: ProjectState): Promise<void> {
    await writeProjectState(projectDir, state);
  }

  private toHandle(
    state: ProjectState,
    slot: SlotRecord,
    extra: {
      reused: boolean;
      nodeModulesPreserved: boolean;
      lockfileChanged: boolean;
      dependencySyncRequested: boolean;
      recommendSparseCheckout: boolean;
      recommendedParallelism: number;
      worktreeAddDurationMs: number;
      attemptBranchState: AttemptBranchState;
      recreatedFromCheckpoint: string | null;
      headCommit: string;
    },
  ): SlotHandle {
    return {
      projectId: state.projectId,
      projectShortId: state.projectShortId,
      slotId: slot.slotId,
      slotPath: slot.slotPath,
      kind: slot.kind,
      mainRepoPath: state.mainRepoPath,
      baseCommit: slot.baseCommit,
      headCommit: extra.headCommit,
      branch: slot.branch,
      headMode: "detached",
      reused: extra.reused,
      nodeModulesPreserved: extra.nodeModulesPreserved,
      lockfileChanged: extra.lockfileChanged,
      dependencySyncRequested: extra.dependencySyncRequested,
      recommendSparseCheckout: extra.recommendSparseCheckout,
      recommendedParallelism: extra.recommendedParallelism,
      worktreeAddDurationMs: extra.worktreeAddDurationMs,
      attemptBranchState: extra.attemptBranchState,
      recreatedFromCheckpoint: extra.recreatedFromCheckpoint,
    };
  }
}

export function defaultWorktreeRoot(): string {
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData && localAppData.length > 0) return path.join(localAppData, "EFHarness", "wt");
  return path.join(os.homedir(), ".local", "share", "EFHarness", "wt");
}

function assertProjectId(projectId: string): void {
  if (!projectId || /[\\/\0]/.test(projectId)) {
    throw new WorktreeSlotError("invalid_project_id", "projectId must be a non-empty path-safe token");
  }
}

function sparsePathList(sparse: SparseCheckoutRequest | undefined): string[] {
  if (!sparse) return [];
  const combined = [...sparse.readSet, ...sparse.sharedPackages];
  const unique: string[] = [];
  for (const item of combined) {
    assertSafeRelativePath(item, "sparse path");
    if (!unique.includes(item)) unique.push(item);
  }
  return unique;
}
