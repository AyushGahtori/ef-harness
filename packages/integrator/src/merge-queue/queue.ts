import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MergeBatchBisector, type BisectProbe } from "./bisector.js";
import {
  FEATURE_COMPLETED_KIND,
  INTEGRATION_REF,
  MAX_BATCH,
  MAX_CAS_RETRIES,
  MAX_INTEGRATOR_ATTEMPTS,
  PREVIEW_RELOAD_KIND,
  type QueueStatus,
} from "./constants.js";
import { verifyFeatureDoneConditions } from "./done-gate.js";
import { ProjectIntegratorEngine } from "./engine.js";
import { CasDriftError, GitCommandError, MergeQueueError, RefLeaseHeldError, SimulatedCrash } from "./errors.js";
import { CombinedRegressionGate, listWorktreeFiles } from "./gate.js";
import { commitMessage, commitParents, conflictedPaths, gitOk, revParse, runGit } from "./git.js";
import { lintMigrations, readMigrationFiles, renderMigrationAst } from "./migrations.js";
import { hasConflictMarkers, parseConflictHunks } from "./conflicts.js";
import { RefLeasePort } from "./ref-lease.js";
import { openMergeQueueStateDb, sqlNumber, sqlText, type MergeQueueStateDb, type SqlValue } from "./state-db.js";
import { parseEfTrailers, buildTrailers, renderCommitMessage } from "./trailers.js";
import type {
  ConflictHunk,
  DrainReport,
  Escalation,
  EvictedFeature,
  FailingCheck,
  FeatureCanonicalSpec,
  FeatureDoneCheckResult,
  FeatureDoneEvidenceInput,
  FileReplacement,
  GateResult,
  LandedFeature,
  MergeFeatureRequest,
  MigrationIssue,
  OffendingCommit,
  PreviewReloadEvent,
  ProjectIntegratorModel,
  QueuedFeature,
  RecoveryReport,
} from "./types.js";
import { MergeWorktreePort } from "./worktree.js";

export interface MergeQueueHooks {
  readonly beforeCas?: (info: {
    readonly expectedSha: string;
    readonly newSha: string;
    readonly featureIds: readonly string[];
  }) => void;
  readonly afterGate?: (info: {
    readonly expectedSha: string;
    readonly newSha: string;
    readonly featureIds: readonly string[];
  }) => void;
  readonly afterCas?: (info: {
    readonly expectedSha: string;
    readonly newSha: string;
    readonly featureIds: readonly string[];
  }) => void;
}

export interface ProjectMergeQueueOptions {
  readonly repo: string;
  readonly stateFile: string;
  readonly now?: () => number;
  readonly model?: ProjectIntegratorModel;
  readonly hooks?: MergeQueueHooks;
  readonly integrationWorktree?: string;
}

interface GateSnapshot {
  readonly staticAuditClean: boolean;
  readonly journeyPassed: boolean;
  readonly regressionPassed: boolean;
  readonly coveredFeatureIds: readonly string[];
}

interface StageOutcome {
  readonly ok: boolean;
  readonly kind: "gate" | "contract_clash";
  readonly trace: string;
  readonly failingChecks: readonly FailingCheck[];
  readonly expectedSha: string;
  readonly sha: string;
  readonly gate: GateResult | null;
}

interface FixRequest {
  readonly attempt: number;
  readonly failingChecks: readonly FailingCheck[];
}

type EvictKind = "gate" | "contract_clash" | "done_refused";

const ACTIVE = new Set(["QUEUED", "STAGING", "VERIFYING"]);

/**
 * Serialized project merge queue.
 * Local ports stand in for sibling tasks that are not on this branch:
 * Task 009 schema, Task 022 DONE gate, Task 038 merge worktree, Task 039 ref lease,
 * Task 052 template database, Task 055 verifier, and Task 110 migration order.
 * `harness/integration` moves only by compare-and-swap after CombinedRegressionGate.
 */
export class ProjectMergeQueue {
  readonly engine: ProjectIntegratorEngine;
  private readonly db: MergeQueueStateDb;
  private readonly repo: string;
  private readonly now: () => number;
  private readonly hooks: MergeQueueHooks | undefined;
  private readonly integrationWorktree: string | undefined;
  private readonly lease: RefLeasePort;
  private readonly worktrees: MergeWorktreePort;
  private readonly gate: CombinedRegressionGate;
  private epoch = 0;
  private readonly landed: LandedFeature[] = [];
  private readonly evicted: EvictedFeature[] = [];
  private readonly escalations: Escalation[] = [];

  constructor(options: ProjectMergeQueueOptions) {
    this.repo = options.repo;
    this.now = options.now ?? (() => Date.now());
    this.hooks = options.hooks;
    this.integrationWorktree = options.integrationWorktree;
    this.db = openMergeQueueStateDb(options.stateFile);
    this.engine = new ProjectIntegratorEngine(options.model);
    this.lease = new RefLeasePort(this.db, options.repo, this.now);
    this.worktrees = new MergeWorktreePort(this.db, options.repo, this.now);
    this.gate = new CombinedRegressionGate();
  }

  enqueue(request: MergeFeatureRequest): string {
    assertFeatureRequest(request);
    const prior = this.db.get(
      "SELECT status, eviction_count FROM merge_queue_items WHERE feature_id = ? ORDER BY sequence DESC LIMIT 1",
      [request.featureId],
    );
    if (prior) {
      const status = sqlText(prior, "status");
      if (ACTIVE.has(status)) {
        throw new MergeQueueError("duplicate_feature", `${request.featureId} is already ${status}`);
      }
      if (status === "LANDED") {
        throw new MergeQueueError("already_landed", `${request.featureId} already landed`);
      }
      if (status === "ESCALATED") {
        throw new MergeQueueError("escalated", `${request.featureId} is waiting on a decision`);
      }
    }
    const carried = prior && sqlText(prior, "status") === "EVICTED" ? sqlNumber(prior, "eviction_count") : 0;
    const now = this.now();
    const sequenceRow = this.db.get("SELECT COALESCE(MAX(sequence), 0) AS sequence FROM merge_queue_items", []);
    const sequence = sqlNumber(sequenceRow, "sequence") + 1;
    const id = `mq-${sequence}`;
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO merge_queue_items (
           id, feature_id, feature_ref, priority, sequence, status, phase, enqueued_at, updated_at,
           eviction_count, failure_trace, request_json, merge_sha, escalation_json, gate_json
         ) VALUES (?, ?, ?, ?, ?, 'QUEUED', 'queued', ?, ?, ?, '', ?, '', '', '')`,
        [
          id,
          request.featureId,
          request.featureRef,
          request.priority ?? 0,
          sequence,
          now,
          now,
          carried,
          JSON.stringify(request),
        ],
      );
      this.setRuntime(request.featureId, "QUEUED_FOR_MERGE", request.featureRef, "");
    });
    return id;
  }

  async drain(): Promise<DrainReport> {
    try {
      const acquired = this.lease.acquire();
      this.epoch = acquired.epoch;
      this.landed.splice(0, this.landed.length);
      this.evicted.splice(0, this.evicted.length);
      this.escalations.splice(0, this.escalations.length);
    } catch (error) {
      if (error instanceof RefLeaseHeldError) {
        return {
          blocked: "lease_held",
          landed: [],
          evicted: [],
          escalations: [],
          integrationSha: this.integrationSha(),
        };
      }
      throw error;
    }
    try {
      for (;;) {
        const batch = this.takeBatch();
        if (batch.length === 0) break;
        await this.process(batch);
      }
      return {
        blocked: null,
        landed: [...this.landed],
        evicted: [...this.evicted],
        escalations: [...this.escalations],
        integrationSha: this.integrationSha(),
      };
    } finally {
      this.lease.release(this.epoch);
    }
  }

  recover(): RecoveryReport {
    const removed: string[] = [];
    for (const slot of this.worktrees.recorded()) {
      this.worktrees.remove(slot);
      removed.push(slot);
    }
    const integrationSha = this.integrationSha();
    const requeued: string[] = [];
    const reconciledLanded: string[] = [];
    const rows = this.db.all(
      `SELECT id, feature_id, feature_ref, priority, sequence, status, phase, eviction_count, failure_trace,
              request_json, merge_sha, gate_json
       FROM merge_queue_items WHERE status IN ('STAGING', 'VERIFYING') ORDER BY sequence ASC`,
      [],
    );
    for (const row of rows) {
      const feature = this.toItem(row);
      if (feature.mergeSha.length > 0 && feature.mergeSha === integrationSha) {
        this.reconcileLanded(feature);
        reconciledLanded.push(feature.featureId);
        continue;
      }
      this.db.run(
        `UPDATE merge_queue_items
         SET status = 'QUEUED', phase = 'queued', merge_sha = '', gate_json = '', failure_trace = '', updated_at = ?
         WHERE id = ?`,
        [this.now(), feature.id],
      );
      requeued.push(feature.featureId);
    }
    this.lease.releaseOwn();
    return { requeued, reconciledLanded, removedWorktrees: removed, integrationSha };
  }

  integrationSha(): string {
    return revParse(this.repo, INTEGRATION_REF);
  }

  runtimeState(featureId: string): string {
    const row = this.db.get(
      "SELECT runtime_state AS state FROM merge_queue_items WHERE feature_id = ? ORDER BY updated_at DESC LIMIT 1",
      [featureId],
    );
    return sqlText(row, "state");
  }

  itemStatus(featureId: string): string {
    const row = this.db.get(
      "SELECT status FROM merge_queue_items WHERE feature_id = ? ORDER BY sequence DESC LIMIT 1",
      [featureId],
    );
    return sqlText(row, "status");
  }

  events(): { kind: string; payload: string }[] {
    return this.db
      .all("SELECT kind, payload_json FROM merge_queue_events ORDER BY id ASC", [])
      .map((row) => ({ kind: sqlText(row, "kind"), payload: sqlText(row, "payload_json") }));
  }

  close(): void {
    for (const slot of [...this.worktrees.recorded()]) {
      this.worktrees.remove(slot);
    }
    this.gate.close();
    this.db.close();
  }

  private async process(batch: readonly QueuedFeature[]): Promise<void> {
    const bisector = new MergeBatchBisector({
      probe: (features) => this.probe(features),
      land: (features) => this.landWithRetry(features),
      evict: (feature, trace, failingChecks, kind) => {
        this.evictOne(feature, trace, failingChecks, kind);
      },
      interact: (features, info) => this.resolveInteraction(features, info),
    });
    await bisector.resolve(batch);
  }

  private async probe(features: readonly QueuedFeature[]): Promise<BisectProbe> {
    const staged = await this.stage(features, null);
    return {
      ok: staged.ok,
      trace: staged.trace,
      failingChecks: staged.failingChecks,
      kind: staged.kind,
    };
  }

  private async landWithRetry(features: readonly QueuedFeature[]): Promise<void> {
    if (features.length === 0) return;
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt += 1) {
      const staged = await this.stage(features, null);
      if (!staged.ok) {
        if (features.length === 1) {
          const only = features[0];
          if (only) this.evictOne(only, staged.trace, staged.failingChecks, staged.kind);
          return;
        }
        const last = features.at(-1);
        await this.landWithRetry(features.slice(0, -1));
        if (last) this.evictOne(last, staged.trace, staged.failingChecks, staged.kind);
        return;
      }
      const outcome = await this.commitIfGreen(features, staged);
      if (outcome === "landed" || outcome === "refused") return;
    }
    throw new CasDriftError(INTEGRATION_REF);
  }

  private async resolveInteraction(features: readonly QueuedFeature[], probe: BisectProbe): Promise<void> {
    if (probe.kind === "contract_clash") {
      await this.landInnocent(features, probe);
      return;
    }
    let trace = probe.trace;
    let failing = probe.failingChecks;
    for (let attempt = 1; attempt <= MAX_INTEGRATOR_ATTEMPTS; attempt += 1) {
      const staged = await this.stage(features, { attempt, failingChecks: failing });
      if (!staged.ok) {
        trace = staged.trace;
        if (staged.failingChecks.length > 0) failing = staged.failingChecks;
        continue;
      }
      const outcome = await this.commitIfGreen(features, staged);
      if (outcome === "mismatch") continue;
      return;
    }
    this.escalate(features, "developer", trace, failing);
  }

  private async landInnocent(features: readonly QueuedFeature[], probe: BisectProbe): Promise<void> {
    for (const feature of features) {
      const staged = await this.stage([feature], null);
      if (!staged.ok) {
        this.evictOne(feature, staged.trace || probe.trace, staged.failingChecks, staged.kind);
        continue;
      }
      await this.landWithRetry([feature]);
    }
  }

  private async stage(features: readonly QueuedFeature[], fix: FixRequest | null): Promise<StageOutcome> {
    const expectedSha = revParse(this.repo, INTEGRATION_REF);
    this.transition(features, "STAGING", "staging");
    const slot = this.worktrees.acquire(expectedSha);
    try {
      for (const feature of features) {
        const merged = await this.mergeFeature(slot.slotPath, feature, features);
        if (!merged.ok) {
          return {
            ok: false,
            kind: "contract_clash",
            trace: merged.trace,
            failingChecks: [],
            expectedSha,
            sha: expectedSha,
            gate: null,
          };
        }
      }
      const migrated = await this.repairMigrations(slot.slotPath, features);
      if (!migrated.ok) {
        return {
          ok: false,
          kind: "contract_clash",
          trace: migrated.trace,
          failingChecks: [],
          expectedSha,
          sha: revParse(slot.slotPath, "HEAD"),
          gate: null,
        };
      }
      let sha = revParse(slot.slotPath, "HEAD");
      this.transition(features, "VERIFYING", "verifying");
      this.remember(features, sha, null);
      let gate = await this.gate.run({
        repo: slot.slotPath,
        worktree: slot.slotPath,
        baseSha: expectedSha,
        headSha: sha,
      });
      if (!gate.ok && fix) {
        const resolved = await this.resolveTree(slot.slotPath, features, {
          conflicts: [],
          migrationIssues: [],
          failingChecks: fix.failingChecks,
          attempt: fix.attempt,
        });
        if (!resolved.ok) {
          this.fireAfterGate(expectedSha, sha, features);
          return {
            ok: false,
            kind: "gate",
            trace: resolved.trace,
            failingChecks: fix.failingChecks,
            expectedSha,
            sha,
            gate,
          };
        }
        this.commitIfDirty(slot.slotPath, fixMessage(features));
        sha = revParse(slot.slotPath, "HEAD");
        this.remember(features, sha, null);
        gate = await this.gate.run({
          repo: slot.slotPath,
          worktree: slot.slotPath,
          baseSha: expectedSha,
          headSha: sha,
        });
      }
      this.fireAfterGate(expectedSha, sha, features);
      if (!gate.ok) {
        return {
          ok: false,
          kind: "gate",
          trace: gate.failingChecks.map((check) => `${check.id}: ${check.trace}`).join("\n"),
          failingChecks: [...gate.failingChecks],
          expectedSha,
          sha,
          gate,
        };
      }
      return { ok: true, kind: "gate", trace: "", failingChecks: [], expectedSha, sha, gate };
    } catch (error) {
      if (error instanceof SimulatedCrash || error instanceof GitCommandError) throw error;
      if (error instanceof MergeQueueError) {
        return {
          ok: false,
          kind: "contract_clash",
          trace: error.message,
          failingChecks: [],
          expectedSha,
          sha: expectedSha,
          gate: null,
        };
      }
      throw error;
    } finally {
      this.worktrees.remove(slot.slotPath);
    }
  }

  private async commitIfGreen(features: readonly QueuedFeature[], staged: StageOutcome): Promise<"landed" | "refused" | "mismatch"> {
    const gate = staged.gate;
    if (!gate) return "refused";
    const accepted: QueuedFeature[] = [];
    const refused: { feature: QueuedFeature; check: FeatureDoneCheckResult }[] = [];
    for (const feature of features) {
      const check = this.evaluateDone(feature, staged, gate);
      if (check.ok) accepted.push(feature);
      else refused.push({ feature, check });
    }
    if (refused.length > 0) {
      for (const item of refused) {
        this.evictOne(
          item.feature,
          `feature DONE refused: ${item.check.failedConditions.join(",")}`,
          [],
          "done_refused",
        );
      }
      if (accepted.length > 0) await this.landWithRetry(accepted);
      return "refused";
    }
    const snapshot = gateSnapshot(gate);
    this.remember(features, staged.sha, snapshot);
    const info = {
      expectedSha: staged.expectedSha,
      newSha: staged.sha,
      featureIds: features.map((feature) => feature.featureId),
    };
    this.hooks?.beforeCas?.(info);
    const cas = this.lease.advance(staged.sha, staged.expectedSha, this.epoch);
    if (!cas.ok) return "mismatch";
    this.hooks?.afterCas?.(info);
    this.markLanded(features, staged, gate);
    return "landed";
  }

  private async mergeFeature(
    worktree: string,
    feature: QueuedFeature,
    batch: readonly QueuedFeature[],
  ): Promise<{ ok: true } | { ok: false; trace: string }> {
    const trailers = buildTrailers({
      featureId: feature.featureId,
      taskIds: feature.request.taskIds,
      requirementIds: feature.request.requirementIds,
      checkIds: feature.request.checkIds,
    });
    const message = renderCommitMessage(
      worktree,
      `Merge ${feature.featureId} into harness/integration`,
      feature.request.spec.title,
      trailers,
    );
    const merged = runGit(worktree, ["merge", "--no-ff", "--no-commit", feature.featureRef]);
    if (merged.status !== 0) {
      const paths = conflictedPaths(worktree);
      if (paths.length === 0) {
        return { ok: false, trace: (merged.stderr || merged.stdout).trim() || "merge failed" };
      }
      let trace = `conflict in ${paths.join(", ")}`;
      let fixed = false;
      for (let attempt = 1; attempt <= MAX_INTEGRATOR_ATTEMPTS; attempt += 1) {
        const resolved = await this.resolveTree(worktree, batch, {
          conflicts: conflictHunks(worktree, paths),
          migrationIssues: [],
          failingChecks: [],
          attempt,
        });
        if (!resolved.ok) {
          trace = resolved.trace;
          continue;
        }
        if (conflictedPaths(worktree).length > 0 || treeHasMarkers(worktree, paths)) {
          trace = "unresolved conflict markers";
          continue;
        }
        fixed = true;
        break;
      }
      if (!fixed) {
        runGit(worktree, ["merge", "--abort"]);
        return { ok: false, trace };
      }
    }
    const mergeHead = runGit(worktree, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]);
    if (mergeHead.status !== 0) {
      return { ok: false, trace: `${feature.featureId} is already contained in harness/integration` };
    }
    gitOk(worktree, ["commit", "-F", "-"], message);
    return { ok: true };
  }

  private async repairMigrations(worktree: string, features: readonly QueuedFeature[]): Promise<{ ok: boolean; trace: string }> {
    let issues = lintMigrations(readMigrationFiles(worktree));
    if (issues.length === 0) return { ok: true, trace: "" };
    let trace = issues.map((issue) => issue.detail).join("\n");
    for (let attempt = 1; attempt <= MAX_INTEGRATOR_ATTEMPTS; attempt += 1) {
      const resolved = await this.resolveTree(worktree, features, {
        conflicts: [],
        migrationIssues: issues,
        failingChecks: [],
        attempt,
      });
      if (!resolved.ok) {
        trace = resolved.trace;
        continue;
      }
      this.commitIfDirty(worktree, fixMessage(features));
      issues = lintMigrations(readMigrationFiles(worktree));
      if (issues.length === 0) return { ok: true, trace: "" };
      trace = issues.map((issue) => issue.detail).join("\n");
    }
    return { ok: false, trace };
  }

  private async resolveTree(
    worktree: string,
    features: readonly QueuedFeature[],
    input: {
      readonly conflicts: readonly ConflictHunk[];
      readonly migrationIssues: readonly MigrationIssue[];
      readonly failingChecks: readonly FailingCheck[];
      readonly attempt: number;
    },
  ): Promise<{ ok: boolean; trace: string }> {
    const before = readTextFiles(worktree);
    const resolution = await this.engine.resolve({
      attempt: input.attempt,
      featureIds: features.map((feature) => feature.featureId),
      conflicts: input.conflicts,
      specs: this.specsFor(features),
      migrationAst: renderMigrationAst(readMigrationFiles(worktree)),
      migrationIssues: input.migrationIssues,
      failingChecks: input.failingChecks,
      offendingCommits: this.offending(features),
      worktree,
      beforeFiles: before,
      conflictOriginals: before.filter((file) => hasConflictMarkers(file.text)),
    });
    if (!resolution.ok) return { ok: false, trace: resolution.detail };
    this.applyReplacements(worktree, resolution.files);
    return { ok: true, trace: resolution.detail };
  }

  private applyReplacements(worktree: string, files: readonly FileReplacement[]): void {
    for (const file of files) {
      const full = path.join(worktree, ...file.path.split("/"));
      if (file.text === null) {
        if (existsSync(full)) rmSync(full);
        runGit(worktree, ["rm", "-f", "--ignore-unmatch", "--", file.path]);
        continue;
      }
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, file.text, "utf8");
      gitOk(worktree, ["add", "--", file.path]);
    }
  }

  private commitIfDirty(worktree: string, message: string): void {
    gitOk(worktree, ["add", "-A"]);
    const status = gitOk(worktree, ["status", "--porcelain"]).stdout.trim();
    if (!status) return;
    gitOk(worktree, ["commit", "-F", "-"], message);
  }

  private evaluateDone(feature: QueuedFeature, staged: StageOutcome, gate: GateResult): FeatureDoneCheckResult {
    const mergeSha = this.featureMergeSha(staged.expectedSha, staged.sha, feature.featureId);
    return verifyFeatureDoneConditions(this.evidence(feature, mergeSha, gateSnapshot(gate)), feature.request.snapshot);
  }

  private evidence(feature: QueuedFeature, mergeSha: string, gate: GateSnapshot): FeatureDoneEvidenceInput {
    const findings = feature.request.seriousFindingIds;
    return {
      feature: feature.featureId,
      staticAudit: {
        clean: gate.staticAuditClean,
        integratorCommitsIncluded: true,
        paths: feature.request.staticAuditPaths,
      },
      journey: {
        passed: gate.journeyPassed,
        entryPoint: feature.request.journeyEntryPoint,
        cleanEnvironment: true,
      },
      integrationMerge: {
        ref: INTEGRATION_REF,
        mergeCommit: mergeSha,
        earlierDoneRegressionGreen: gate.regressionPassed,
        regressedFeatureIds: gate.coveredFeatureIds,
      },
      accessibility: {
        seriousFindingIds: findings ? [...findings] : [],
      },
    };
  }

  private featureMergeSha(oldSha: string, newSha: string, featureId: string): string {
    if (oldSha === newSha) return "";
    const listed = runGit(this.repo, ["log", "--merges", "--format=%H", `${oldSha}..${newSha}`]);
    if (listed.status !== 0) return "";
    for (const sha of listed.stdout.split(/\r?\n/)) {
      const trimmed = sha.trim();
      if (!trimmed) continue;
      const trailers = parseEfTrailers(commitMessage(this.repo, trimmed));
      if (trailers?.feature === featureId) return trimmed;
    }
    return "";
  }

  private markLanded(features: readonly QueuedFeature[], staged: StageOutcome, gate: GateResult): void {
    const snapshot = gateSnapshot(gate);
    const now = this.now();
    const landedNow: LandedFeature[] = [];
    this.db.transaction(() => {
      for (const feature of features) {
        const mergeSha = this.featureMergeSha(staged.expectedSha, staged.sha, feature.featureId);
        const check = verifyFeatureDoneConditions(this.evidence(feature, mergeSha, snapshot), feature.request.snapshot);
        const trailers =
          parseEfTrailers(mergeSha ? commitMessage(this.repo, mergeSha) : "") ??
          buildTrailers({
            featureId: feature.featureId,
            taskIds: feature.request.taskIds,
            requirementIds: feature.request.requirementIds,
            checkIds: feature.request.checkIds,
          });
        const parents = mergeSha ? commitParents(this.repo, mergeSha) : [];
        this.db.run(
          `UPDATE merge_queue_items
           SET status = 'LANDED', phase = 'landed', merge_sha = ?, failure_trace = '', updated_at = ?
           WHERE id = ?`,
          [mergeSha || staged.sha, now, feature.id],
        );
        const doneJson = JSON.stringify({ ok: check.ok, failedConditions: check.failedConditions, mergeSha });
        this.setRuntime(feature.featureId, check.ok ? "DONE" : "MERGED", feature.featureRef, doneJson);
        this.insertEvent(FEATURE_COMPLETED_KIND, { featureId: feature.featureId, mergeSha, failedConditions: check.failedConditions });
        landedNow.push({
          featureId: feature.featureId,
          mergeSha,
          done: true,
          failedConditions: check.failedConditions,
          trailers,
          parents,
        });
      }
      const preview: PreviewReloadEvent = {
        kind: PREVIEW_RELOAD_KIND,
        featureIds: features.map((feature) => feature.featureId),
        integrationSha: staged.sha,
        restartPreview: true,
      };
      this.insertEvent(PREVIEW_RELOAD_KIND, preview);
    });
    this.refreshIntegrationWorktree(staged.sha);
    this.landed.push(...landedNow);
  }

  private reconcileLanded(feature: QueuedFeature): void {
    const gate = parseGate(sqlText(
      this.db.get("SELECT gate_json FROM merge_queue_items WHERE id = ?", [feature.id]),
      "gate_json",
    ));
    const mergeSha = this.featureMergeSha(`${feature.mergeSha}^`, feature.mergeSha, feature.featureId) || feature.mergeSha;
    const check = verifyFeatureDoneConditions(this.evidence(feature, mergeSha, gate), feature.request.snapshot);
    const now = this.now();
    this.db.transaction(() => {
      this.db.run(
        `UPDATE merge_queue_items
         SET status = 'LANDED', phase = 'landed', failure_trace = '', updated_at = ?
         WHERE id = ?`,
        [now, feature.id],
      );
      this.setRuntime(
        feature.featureId,
        check.ok ? "DONE" : "MERGED",
        feature.featureRef,
        JSON.stringify({ ok: check.ok, failedConditions: check.failedConditions, mergeSha, reconciled: true }),
      );
      this.insertEvent(FEATURE_COMPLETED_KIND, {
        featureId: feature.featureId,
        mergeSha,
        failedConditions: check.failedConditions,
        reconciled: true,
      });
    });
    this.refreshIntegrationWorktree(feature.mergeSha);
  }

  private evictOne(
    feature: QueuedFeature,
    trace: string,
    failingChecks: readonly FailingCheck[],
    kind: EvictKind,
  ): void {
    const next = feature.evictionCount + 1;
    if (kind === "contract_clash" && next >= 2) {
      this.escalate([feature], "task-112", trace, failingChecks);
      return;
    }
    const now = this.now();
    this.db.run(
      `UPDATE merge_queue_items
       SET status = 'EVICTED', phase = 'INTEGRATING', eviction_count = ?, failure_trace = ?, merge_sha = '', gate_json = '', updated_at = ?
       WHERE id = ?`,
      [next, trace, now, feature.id],
    );
    this.setRuntime(feature.featureId, "INTEGRATING", feature.featureRef, "");
    this.evicted.push({
      featureId: feature.featureId,
      phase: "INTEGRATING",
      evictionCount: next,
      trace,
      kind,
    });
  }

  private escalate(
    features: readonly QueuedFeature[],
    to: Escalation["to"],
    trace: string,
    failingChecks: readonly FailingCheck[],
  ): void {
    const specs = this.specsFor(features);
    const attempts = to === "developer" ? MAX_INTEGRATOR_ATTEMPTS : Math.max(...features.map((feature) => feature.evictionCount + 1));
    const escalation: Escalation = {
      to,
      featureIds: features.map((feature) => feature.featureId),
      specs,
      attempts,
      trace,
      failingChecks,
    };
    const payload = JSON.stringify(escalation);
    const now = this.now();
    this.db.transaction(() => {
      for (const feature of features) {
        this.db.run(
          `UPDATE merge_queue_items
           SET status = 'ESCALATED', phase = 'INTEGRATING', eviction_count = ?, failure_trace = ?,
               escalation_json = ?, merge_sha = '', updated_at = ?
           WHERE id = ?`,
          [feature.evictionCount + 1, trace, payload, now, feature.id],
        );
        this.setRuntime(feature.featureId, "INTEGRATING", feature.featureRef, "");
      }
      this.insertEvent(to === "task-112" ? "ccr-escalation" : "developer-escalation", escalation);
    });
    this.escalations.push(escalation);
  }

  private takeBatch(): QueuedFeature[] {
    const queued = this.load("QUEUED");
    const first = queued[0];
    if (!first) return [];
    const batch = [first];
    const paths = new Map<string, string[]>([[first.id, this.changedPaths(first)]]);
    for (const next of queued.slice(1)) {
      if (batch.length >= MAX_BATCH) break;
      const nextPaths = this.changedPaths(next);
      const overlaps = batch.some((item) => !disjointPaths(paths.get(item.id) ?? [], nextPaths));
      if (overlaps) break;
      paths.set(next.id, nextPaths);
      batch.push(next);
    }
    return batch;
  }

  private changedPaths(feature: QueuedFeature): string[] {
    const base = revParse(this.repo, INTEGRATION_REF);
    const tip = revParse(this.repo, feature.featureRef);
    const mergeBase = runGit(this.repo, ["merge-base", base, tip]);
    const from = mergeBase.status === 0 ? mergeBase.stdout.trim() : base;
    return gitOk(this.repo, ["diff", "--name-only", from, tip])
      .stdout.split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  private offending(features: readonly QueuedFeature[]): OffendingCommit[] {
    const commits: OffendingCommit[] = [];
    for (const feature of features) {
      const sha = revParse(this.repo, feature.featureRef);
      const message = commitMessage(this.repo, sha);
      commits.push({
        featureId: feature.featureId,
        sha,
        subject: message.split(/\r?\n/)[0] ?? feature.featureId,
      });
    }
    const listed = runGit(this.repo, ["log", "--merges", "-n", "20", "--format=%H", INTEGRATION_REF]);
    if (listed.status !== 0) return commits;
    for (const sha of listed.stdout.split(/\r?\n/)) {
      const trimmed = sha.trim();
      if (!trimmed) continue;
      const trailers = parseEfTrailers(commitMessage(this.repo, trimmed));
      if (!trailers) continue;
      if (commits.some((commit) => commit.featureId === trailers.feature)) continue;
      const message = commitMessage(this.repo, trimmed);
      commits.push({
        featureId: trailers.feature,
        sha: trimmed,
        subject: message.split(/\r?\n/)[0] ?? trailers.feature,
      });
    }
    return commits;
  }

  private specsFor(features: readonly QueuedFeature[]): FeatureCanonicalSpec[] {
    const specs = features.map((feature) => feature.request.spec);
    const seen = new Set(specs.map((spec) => spec.id));
    const rows = this.db.all(
      "SELECT request_json FROM merge_queue_items WHERE status = 'LANDED' ORDER BY sequence ASC",
      [],
    );
    for (const row of rows) {
      const request = parseRequest(sqlText(row, "request_json"));
      if (seen.has(request.spec.id)) continue;
      seen.add(request.spec.id);
      specs.push(request.spec);
    }
    return specs;
  }

  private load(status: QueueStatus): QueuedFeature[] {
    return this.db
      .all(
        `SELECT id, feature_id, feature_ref, priority, sequence, status, phase, eviction_count, failure_trace,
                request_json, merge_sha
         FROM merge_queue_items WHERE status = ? ORDER BY priority DESC, sequence ASC`,
        [status],
      )
      .map((row) => this.toItem(row));
  }

  private toItem(row: Readonly<Record<string, SqlValue>>): QueuedFeature {
    const request = parseRequest(sqlText(row, "request_json"));
    const status = sqlText(row, "status");
    return {
      id: sqlText(row, "id"),
      featureId: sqlText(row, "feature_id"),
      featureRef: sqlText(row, "feature_ref"),
      priority: sqlNumber(row, "priority"),
      sequence: sqlNumber(row, "sequence"),
      status: isStatus(status) ? status : "QUEUED",
      phase: sqlText(row, "phase"),
      evictionCount: sqlNumber(row, "eviction_count"),
      failureTrace: sqlText(row, "failure_trace"),
      request,
      mergeSha: sqlText(row, "merge_sha"),
    };
  }

  private transition(features: readonly QueuedFeature[], status: QueueStatus, phase: string): void {
    const now = this.now();
    this.db.transaction(() => {
      for (const feature of features) {
        this.db.run("UPDATE merge_queue_items SET status = ?, phase = ?, updated_at = ? WHERE id = ?", [
          status,
          phase,
          now,
          feature.id,
        ]);
      }
    });
  }

  private remember(features: readonly QueuedFeature[], sha: string, gate: GateSnapshot | null): void {
    const now = this.now();
    const gateJson = gate ? JSON.stringify(gate) : "";
    this.db.transaction(() => {
      for (const feature of features) {
        if (gate) {
          this.db.run("UPDATE merge_queue_items SET merge_sha = ?, gate_json = ?, updated_at = ? WHERE id = ?", [
            sha,
            gateJson,
            now,
            feature.id,
          ]);
        } else {
          this.db.run("UPDATE merge_queue_items SET merge_sha = ?, updated_at = ? WHERE id = ?", [sha, now, feature.id]);
        }
      }
    });
  }

  private setRuntime(featureId: string, state: string, branch: string, doneJson: string): void {
    const existing = this.db.get(
      "SELECT runtime_epoch AS epoch FROM merge_queue_items WHERE feature_id = ? ORDER BY runtime_epoch DESC LIMIT 1",
      [featureId],
    );
    const epoch = Math.max(1, sqlNumber(existing, "epoch") + 1);
    this.db.run(
      `UPDATE merge_queue_items
       SET runtime_state = ?, runtime_epoch = ?, runtime_branch = ?, runtime_updated_at = ?, runtime_done_json = ?
       WHERE feature_id = ?`,
      [state, epoch, branch, this.now(), doneJson, featureId],
    );
  }

  private insertEvent(kind: string, payload: unknown): void {
    this.db.run("INSERT INTO merge_queue_events (kind, payload_json, created_at) VALUES (?, ?, ?)", [
      kind,
      JSON.stringify(payload),
      this.now(),
    ]);
  }

  private refreshIntegrationWorktree(sha: string): void {
    if (!this.integrationWorktree) return;
    gitOk(this.integrationWorktree, ["checkout", "--detach", sha]);
  }

  private fireAfterGate(expectedSha: string, sha: string, features: readonly QueuedFeature[]): void {
    this.hooks?.afterGate?.({
      expectedSha,
      newSha: sha,
      featureIds: features.map((feature) => feature.featureId),
    });
  }
}

function assertFeatureRequest(request: MergeFeatureRequest): void {
  if (!request.featureRef.startsWith("refs/heads/harness/f/")) {
    throw new MergeQueueError("invalid_feature_ref", `${request.featureRef} must be refs/heads/harness/f/<feature>`);
  }
  if (request.featureId.trim().length === 0) {
    throw new MergeQueueError("invalid_feature", "feature id is required");
  }
}

function fixMessage(features: readonly QueuedFeature[]): string {
  return `project-integrator@1 resolve ${features.map((feature) => feature.featureId).join(" ")}\n`;
}

function disjointPaths(left: readonly string[], right: readonly string[]): boolean {
  const known = new Set(left);
  return right.every((item) => !known.has(item));
}

function conflictHunks(worktree: string, paths: readonly string[]): ConflictHunk[] {
  const hunks: ConflictHunk[] = [];
  for (const filePath of paths) {
    const text = readFileSync(path.join(worktree, ...filePath.split("/")), "utf8");
    hunks.push(...parseConflictHunks(filePath, text));
  }
  return hunks;
}

function treeHasMarkers(worktree: string, paths: readonly string[]): boolean {
  return paths.some((filePath) => hasConflictMarkers(readFileSync(path.join(worktree, ...filePath.split("/")), "utf8")));
}

function readTextFiles(root: string): { path: string; text: string }[] {
  const files: { path: string; text: string }[] = [];
  for (const relative of listWorktreeFiles(root)) {
    if (!/\.(?:mjs|cjs|js|json|sql|txt|md)$/.test(relative)) continue;
    files.push({ path: relative, text: readFileSync(path.join(root, relative), "utf8") });
  }
  return files;
}

function gateSnapshot(gate: GateResult): GateSnapshot {
  return {
    staticAuditClean: gate.staticAuditClean,
    journeyPassed: gate.journeyPassed,
    regressionPassed: gate.regressionPassed,
    coveredFeatureIds: gate.coveredFeatureIds,
  };
}

function parseGate(raw: string): GateSnapshot {
  if (!raw.trim()) {
    return { staticAuditClean: true, journeyPassed: true, regressionPassed: true, coveredFeatureIds: [] };
  }
  const parsed = JSON.parse(raw) as Partial<GateSnapshot>;
  return {
    staticAuditClean: parsed.staticAuditClean === true,
    journeyPassed: parsed.journeyPassed === true,
    regressionPassed: parsed.regressionPassed === true,
    coveredFeatureIds: Array.isArray(parsed.coveredFeatureIds)
      ? parsed.coveredFeatureIds.filter((item): item is string => typeof item === "string")
      : [],
  };
}

function parseRequest(raw: string): MergeFeatureRequest {
  const parsed = JSON.parse(raw) as MergeFeatureRequest;
  if (!parsed || typeof parsed !== "object" || typeof parsed.featureId !== "string") {
    throw new MergeQueueError("invalid_request", "queued feature request is unreadable");
  }
  return parsed;
}

function isStatus(value: string): value is QueueStatus {
  return (
    value === "QUEUED" ||
    value === "STAGING" ||
    value === "VERIFYING" ||
    value === "LANDED" ||
    value === "EVICTED" ||
    value === "ESCALATED"
  );
}
