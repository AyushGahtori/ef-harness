import fs from "node:fs";
import path from "node:path";
import { RefLeaseManager, WorktreeSlotPool, createDirectGitRunner, createProcessGitRunner } from "@ef-harness/git-engine";
import type { RefLeaseStateDb } from "@ef-harness/git-engine";
import {
  ActiveTurnSyncError,
  CasMismatchError,
  DirtyWorktreeSyncError,
  FeatureBranchError,
  HistoryRewriteRefusedError,
  IntegrationUnverifiedError,
  PruneRefusedError,
} from "./errors.js";
import { catFileType, countExclusive, gitOk, isAncestor, porcelain, revParse, tryRevParse } from "./git.js";
import { alignCleanWorktree, commitTree, LocalRefLeaseManager, writeTree } from "./ref-lease.js";
import { FeatureBranchStore, type FeatureBranchStateDb } from "./state-db.js";
import {
  assertFeatureSlug,
  featureRef,
  INTEGRATION_REF,
  isAggregatorLockfile,
  ZERO_OID,
  type FeatureBranchRecord,
  type IntegrationHeadVerifier,
  type OpenFeatureInput,
  type RecoveryResult,
  type SyncOutcome,
} from "./types.js";
import { LocalWorktreeSlotPool } from "./worktree-pool.js";

const LEASE_HOLDER = "parallel-feature-branch-manager";

function adaptRefLeaseDb(db: FeatureBranchStateDb): RefLeaseStateDb {
  return {
    async transaction<T>(fn: () => T | Promise<T>): Promise<T> {
      return db.transaction(() => fn());
    },
    get(sql, params) {
      return db.get(sql, params);
    },
    all(sql, params) {
      return db.all(sql, params);
    },
    run(sql, params) {
      return db.run(sql, params);
    },
    close() {
      return;
    },
  };
}

const acceptIntegrationHead: IntegrationHeadVerifier = {
  verify: () => ({ ok: true }),
};

export class ParallelFeatureBranchManager {
  readonly store: FeatureBranchStore;
  readonly leases: LocalRefLeaseManager;
  readonly pool: LocalWorktreeSlotPool;
  readonly refCas: RefLeaseManager;
  readonly worktrees: WorktreeSlotPool;
  readonly integrationRef: string;
  private readonly verifier: IntegrationHeadVerifier;
  private readonly now: () => number;
  private detachedSerial = 0;

  constructor(options: {
    readonly repo: string;
    readonly state: FeatureBranchStateDb;
    readonly worktreeRoot: string;
    readonly integrationRef?: string;
    readonly verifier?: IntegrationHeadVerifier;
    readonly now?: () => number;
  }) {
    this.repo = options.repo;
    this.integrationRef = options.integrationRef ?? INTEGRATION_REF;
    this.verifier = options.verifier ?? acceptIntegrationHead;
    this.now = options.now ?? (() => Date.now());
    this.store = new FeatureBranchStore(options.state);
    this.leases = new LocalRefLeaseManager(options.state, options.repo, this.now);
    this.pool = new LocalWorktreeSlotPool(options.repo, options.worktreeRoot, this.store);
    this.refCas = new RefLeaseManager({
      database: adaptRefLeaseDb(options.state),
      git: createDirectGitRunner(),
      repoPath: options.repo,
      clock: this.now,
    });
    this.worktrees = new WorktreeSlotPool({
      wtRoot: options.worktreeRoot,
      git: createProcessGitRunner(),
    });
  }

  readonly repo: string;

  openFeature(input: OpenFeatureInput): FeatureBranchRecord {
    assertFeatureSlug(input.featureSlug);
    if (this.store.read(input.featureId)) {
      throw new FeatureBranchError("duplicate_feature", `Feature ${input.featureId} is already open.`);
    }
    const integrationSha = revParse(this.repo, this.integrationRef);
    const verdict = this.verifier.verify(integrationSha);
    if (!verdict.ok) {
      throw new IntegrationUnverifiedError(verdict.reason);
    }
    const ref = featureRef(input.featureSlug);
    if (this.store.list().some((record) => record.ref === ref)) {
      throw new FeatureBranchError("duplicate_ref", `Ref ${ref} is already tracked.`);
    }
    const lease = this.leases.acquire(ref, LEASE_HOLDER, null);
    const recorded = this.refCas.readRefLease(ref);
    if (!recorded || recorded.holder !== lease.holder || recorded.epoch !== lease.epoch) {
      throw new FeatureBranchError("lease_unwired", `RefLeaseManager did not observe the lease for ${ref}.`);
    }
    this.leases.advance(ref, lease.holder, lease.epoch, integrationSha, ZERO_OID);
    const slot = this.pool.acquireFeature({
      slotId: `feature-${input.featureSlug}`,
      featureId: input.featureId,
      branch: `harness/f/${input.featureSlug}`,
    });
    const record: FeatureBranchRecord = {
      featureId: input.featureId,
      featureSlug: input.featureSlug,
      waveId: input.waveId,
      ref,
      baseIntegrationSha: integrationSha,
      headSha: integrationSha,
      verifiedHeadSha: integrationSha,
      pinnedBaseCommitSha: integrationSha,
      activeLeafSlots: [],
      behindIntegrationCount: 0,
      status: "active",
      syncReason: null,
      landedByTask: null,
      leaseHolder: lease.holder,
      leaseEpoch: lease.epoch,
      worktreePath: slot.path,
    };
    this.store.insert(record, this.now());
    return record;
  }

  read(featureId: string): FeatureBranchRecord {
    const record = this.store.read(featureId);
    if (!record) throw new FeatureBranchError("unknown_feature", `Feature ${featureId} is not open.`);
    return record;
  }

  listActive(): FeatureBranchRecord[] {
    return this.store
      .list()
      .filter((record) => record.status === "active" || record.status === "sync_scheduled");
  }

  commitFeatureFiles(
    featureId: string,
    files: Readonly<Record<string, string>>,
    message: string,
    deletes: readonly string[] = [],
  ): string {
    const record = this.read(featureId);
    const paths = [...Object.keys(files), ...deletes];
    if (paths.some((relative) => isAggregatorLockfile(relative))) {
      throw new FeatureBranchError(
        "direct_lockfile_edit",
        "Feature workers cannot edit package.json or pnpm-lock.yaml. Submit a DependencyIntent so DependencyIntentAggregator can serialize one lockfile commit.",
      );
    }
    const worktree = this.requireWorktree(record);
    for (const [relative, content] of Object.entries(files)) {
      const full = path.join(worktree, relative);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      const text = content.endsWith("\n") ? content : `${content}\n`;
      fs.writeFileSync(full, text, "utf8");
    }
    for (const relative of deletes) {
      fs.rmSync(path.join(worktree, relative), { force: true });
    }
    if (paths.length === 0) {
      throw new FeatureBranchError("empty_commit", "A feature commit needs at least one path.");
    }
    gitOk({ repo: worktree, args: ["add", "-A", "--", ...paths] });
    const old = revParse(worktree, "HEAD");
    if (old !== record.headSha) throw new CasMismatchError(old);
    const tree = writeTree(worktree);
    const next = commitTree(worktree, tree, old, message);
    this.leases.advance(record.ref, record.leaseHolder, record.leaseEpoch, next, old);
    alignCleanWorktree(worktree);
    this.persist(this.withHead(record, next));
    return next;
  }

  beginTurn(featureId: string, slotId: string): void {
    const record = this.read(featureId);
    const slots = record.activeLeafSlots.includes(slotId)
      ? record.activeLeafSlots
      : [...record.activeLeafSlots, slotId];
    this.store.setTurn(featureId, slotId, "running");
    this.persist({ ...record, activeLeafSlots: slots });
  }

  endTurn(featureId: string, slotId: string): void {
    this.read(featureId);
    this.store.setTurn(featureId, slotId, "boundary");
  }

  releaseLeaf(featureId: string, slotId: string): void {
    const record = this.read(featureId);
    this.store.clearTurn(featureId, slotId);
    this.persist({
      ...record,
      activeLeafSlots: record.activeLeafSlots.filter((slot) => slot !== slotId),
    });
  }

  runningTurnCount(featureId: string): number {
    return this.store.runningTurns(featureId);
  }

  registerReadSet(featureId: string, paths: readonly string[]): void {
    this.read(featureId);
    this.store.replacePaths("feature_read_sets", "path", featureId, paths);
  }

  registerWriteScope(featureId: string, prefixes: readonly string[]): void {
    this.read(featureId);
    this.store.replacePaths("feature_write_scopes", "path_prefix", featureId, prefixes);
  }

  readSet(featureId: string): string[] {
    return this.store.paths("feature_read_sets", "path", featureId);
  }

  writeScope(featureId: string): string[] {
    return this.store.paths("feature_write_scopes", "path_prefix", featureId);
  }

  refreshBehind(featureId: string): number {
    const record = this.read(featureId);
    const integration = revParse(this.repo, this.integrationRef);
    const behind = countExclusive(this.repo, record.headSha, integration);
    this.persist({ ...record, behindIntegrationCount: behind });
    return behind;
  }

  markScheduled(featureId: string, reason: string): void {
    const record = this.read(featureId);
    this.persist({ ...record, status: "sync_scheduled", syncReason: reason });
  }

  markActive(featureId: string): void {
    const record = this.read(featureId);
    if (record.status === "landed" || record.status === "pruned") return;
    this.persist({ ...record, status: "active", syncReason: null });
  }

  /**
   * Fast-forward or merge `harness/integration` into the feature branch.
   * `rebase` is refused. A running leaf turn is refused before any ref or worktree change.
   */
  syncFromIntegration(featureId: string, strategy: "merge" | "rebase" = "merge"): SyncOutcome {
    if (strategy === "rebase") throw new HistoryRewriteRefusedError();
    const record = this.read(featureId);
    if (this.runningTurnCount(featureId) > 0) throw new ActiveTurnSyncError(featureId);
    const worktree = this.requireWorktree(record);
    if (porcelain(worktree).trim()) throw new DirtyWorktreeSyncError(featureId);
    const integration = revParse(this.repo, this.integrationRef);
    const previousHead = revParse(this.repo, record.ref);
    if (previousHead === integration || isAncestor(this.repo, integration, previousHead)) {
      const behind = countExclusive(this.repo, previousHead, integration);
      this.persist({
        ...record,
        baseIntegrationSha: integration,
        behindIntegrationCount: behind,
        status: "active",
        syncReason: null,
      });
      return {
        action: "up_to_date",
        method: "none",
        previousHead,
        newHead: previousHead,
        pinnedBaseCommitSha: record.pinnedBaseCommitSha,
      };
    }
    const method = isAncestor(this.repo, previousHead, integration) ? "fast-forward" : "merge";
    this.detachedSerial += 1;
    const detached = this.pool.acquireDetached({
      slotId: `sync-${record.featureSlug}-${this.detachedSerial}`,
      sha: previousHead,
      featureId,
    });
    try {
      if (method === "fast-forward") {
        gitOk({ repo: detached.path, args: ["merge", "--ff-only", integration] });
      } else {
        gitOk({ repo: detached.path, args: ["merge", "--no-ff", "--no-edit", integration] });
      }
      const next = revParse(detached.path, "HEAD");
      this.leases.advance(record.ref, record.leaseHolder, record.leaseEpoch, next, previousHead);
      alignCleanWorktree(worktree);
      this.persist({
        ...record,
        headSha: next,
        verifiedHeadSha: next,
        baseIntegrationSha: integration,
        behindIntegrationCount: 0,
        status: "active",
        syncReason: null,
        pinnedBaseCommitSha: record.pinnedBaseCommitSha,
      });
      return {
        action: "synced",
        method,
        previousHead,
        newHead: next,
        pinnedBaseCommitSha: record.pinnedBaseCommitSha,
      };
    } finally {
      this.pool.release(detached.slotId);
    }
  }

  markMergeQueueLanded(featureId: string, integrationSha: string): FeatureBranchRecord {
    const record = this.read(featureId);
    const current = revParse(this.repo, this.integrationRef);
    if (current !== integrationSha) {
      throw new FeatureBranchError(
        "integration_mismatch",
        `Task 111 reported ${integrationSha} but ${this.integrationRef} is ${current}.`,
      );
    }
    if (!isAncestor(this.repo, record.headSha, integrationSha)) {
      throw new FeatureBranchError(
        "not_reachable",
        `Feature ${featureId} is not reachable from harness/integration, so it cannot be marked landed.`,
      );
    }
    const landed: FeatureBranchRecord = { ...record, status: "landed", landedByTask: 111, syncReason: null };
    this.persist(landed);
    return landed;
  }

  pruneLanded(featureId: string): void {
    const record = this.read(featureId);
    if (record.status !== "landed" || record.landedByTask !== 111) {
      throw new PruneRefusedError("harness/f/* refs are pruned only after Task 111 merge-queue landing.");
    }
    const integration = revParse(this.repo, this.integrationRef);
    if (!isAncestor(this.repo, record.headSha, integration)) {
      throw new PruneRefusedError("The feature commit is not reachable from harness/integration.");
    }
    if (record.activeLeafSlots.length > 0) {
      throw new PruneRefusedError("Leaf worktree slots still point at this branch.");
    }
    const detached = this.pool.forFeature(featureId).filter((slot) => slot.role !== "feature");
    if (detached.length > 0) {
      throw new PruneRefusedError("A detached worktree still points at this feature.");
    }
    for (const slot of this.pool.forFeature(featureId)) this.pool.release(slot.slotId);
    this.leases.deleteRef(record.ref, record.leaseHolder, record.leaseEpoch, record.headSha);
    this.persist({ ...record, status: "pruned", worktreePath: null, activeLeafSlots: [], syncReason: null });
  }

  recoverMissingRef(featureId: string): RecoveryResult {
    const record = this.read(featureId);
    const present = tryRevParse(this.repo, record.ref);
    if (present && catFileType(this.repo, present) === "commit") {
      return { recovered: false, sha: present, card: null };
    }
    if (catFileType(this.repo, record.verifiedHeadSha) !== "commit") {
      this.persist({ ...record, status: "missing_ref" });
      return {
        recovered: false,
        sha: null,
        card: {
          kind: "recovery_card",
          featureId,
          ref: record.ref,
          lastVerifiedSha: record.verifiedHeadSha,
          message: `Branch ${record.ref} is missing and ${record.verifiedHeadSha} is not in the object store. Restore the commit, then retry recovery.`,
        },
      };
    }
    this.leases.recreate(record.ref, record.leaseHolder, record.leaseEpoch, record.verifiedHeadSha);
    let worktreePath = record.worktreePath;
    if (!worktreePath || !fs.existsSync(worktreePath)) {
      const slot = this.pool.acquireFeature({
        slotId: `feature-${record.featureSlug}`,
        featureId,
        branch: `harness/f/${record.featureSlug}`,
      });
      worktreePath = slot.path;
    }
    this.persist({
      ...record,
      headSha: record.verifiedHeadSha,
      status: "active",
      worktreePath,
      syncReason: null,
    });
    return { recovered: true, sha: record.verifiedHeadSha, card: null };
  }

  close(): void {
    this.pool.close();
  }

  private withHead(record: FeatureBranchRecord, head: string): FeatureBranchRecord {
    const integration = revParse(this.repo, this.integrationRef);
    return {
      ...record,
      headSha: head,
      verifiedHeadSha: head,
      behindIntegrationCount: countExclusive(this.repo, head, integration),
    };
  }

  private persist(record: FeatureBranchRecord): void {
    this.store.save(record, this.now());
  }

  private requireWorktree(record: FeatureBranchRecord): string {
    if (!record.worktreePath) {
      throw new FeatureBranchError("missing_worktree", `Feature ${record.featureId} has no worktree.`);
    }
    return record.worktreePath;
  }
}
