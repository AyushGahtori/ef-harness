import { randomUUID } from "node:crypto";

import type { SqlStatement, SqlValue, StateConnection } from "./connection.js";
import { evaluateFeatureDoneConditions } from "./done.js";
import {
  ApprovalRequiredError,
  ChangeSetNotFoundError,
  FeatureAlreadyInitializedError,
  FeatureCoupledError,
  FeatureDoneRefusedError,
  FeatureNotFoundError,
  IllegalFeatureTransitionError,
  IllegalProjectTransitionError,
  InvalidLifecycleInputError,
  ProjectCompletionBlockedError,
  ProjectRuntimeMissingError,
  SameIntegrationHolderError,
  StaleEpochError,
  type CompletionBlocker,
  type CoupledFeatureRef,
} from "./errors.js";
import type {
  AdvanceLeavesInput,
  AdvanceLeavesResult,
  FeatureDoneCheckResult,
  FeatureDoneEvidenceInput,
  FeatureTransitionResult,
  InitFeatureInput,
  InitFeatureResult,
  ProjectPauseResult,
  ProjectTransitionResult,
  SetProjectPausedInput,
  TransferHolderInput,
  TransferHolderResult,
  TransitionFeatureInput,
  TransitionProjectInput,
} from "./models.js";
import { loadCanonicalQueries } from "./queries.js";
import { asInt, asNullableInt, asNullableText, asText, requireInt, rowChanges } from "./rows.js";
import {
  FOUNDATION_GATE_META_KEY,
  FOUNDATION_GATE_PASSED_VALUE,
  LIFECYCLE_EVENT_CONSUMERS,
  LIFECYCLE_EVENT_TYPES,
  foundationGatePassedByState,
  isFeatureState,
  isLegalFeatureTransition,
  isLegalProjectTransition,
  isProjectState,
  type FeatureState,
  type LifecycleEventType,
  type ProjectState,
} from "./states.js";

interface FeatureRow {
  readonly feature: string;
  readonly state: FeatureState;
  readonly wave: number | null;
  readonly integrationHolder: string | null;
  readonly epoch: number;
  readonly branch: string | null;
  readonly updatedRev: number;
}

interface ProjectRow {
  readonly state: ProjectState;
  readonly currentWave: number | null;
  readonly paused: 0 | 1;
  readonly updatedRev: number;
}

interface DownstreamHit {
  readonly feature: string;
  readonly state: FeatureState;
  readonly epoch: number;
}

/**
 * Feature and project lifecycle repository.
 * `advance_feature_leaves_merged`, `requirement_status_recompute`, and
 * `register_delivery` are loaded from schema/queries.sql and executed as written.
 */
export class LifecycleRepo {
  private readonly statements = new Map<string, SqlStatement>();

  constructor(
    private readonly db: StateConnection,
    private readonly queries: ReadonlyMap<string, string> = loadCanonicalQueries(),
  ) {
    for (const name of ["advance_feature_leaves_merged", "requirement_status_recompute", "register_delivery"]) {
      if (!this.queries.has(name)) {
        throw new Error(`missing canonical query ${name}`);
      }
    }
  }

  initFeature(input: InitFeatureInput): InitFeatureResult {
    requireInt(input.rev, "rev");
    requireInt(input.now, "now");
    const feature = requireId(input.feature, "feature");
    const planAuthor = requireId(input.planAuthor, "planAuthor");
    if (input.wave !== undefined && input.wave !== null) requireInt(input.wave, "wave", 1);
    const branch = input.branch ?? `harness/f/${feature}`;
    if (branch.trim().length === 0) {
      throw new InvalidLifecycleInputError("branch must be non-empty");
    }
    const wave = input.wave === undefined ? null : input.wave;
    return this.inTransaction(() => {
      const kind = this.sql(`SELECT kind FROM nodes WHERE id = :id`).get({ id: feature });
      if (!kind || asText(kind, "kind") !== "feature") {
        throw new FeatureNotFoundError(feature);
      }
      const existing = this.sql(`SELECT 1 AS ok FROM feature_runtime WHERE feature = :feature`).get({ feature });
      if (existing) throw new FeatureAlreadyInitializedError(feature);
      this.sql(
        `INSERT INTO feature_runtime(feature, state, wave, integration_holder, epoch, branch, updated_rev)
         VALUES (:feature, 'PLANNED', :wave, :holder, 0, :branch, :rev)`,
      ).run({ feature, wave, holder: planAuthor, branch, rev: input.rev });
      this.emit("FeatureStateChanged", feature, input.rev, input.now, {
        feature,
        from: null,
        to: "PLANNED",
        epoch: 0,
        integrationHolder: planAuthor,
        rev: input.rev,
        changeSetId: null,
        heldDownstream: [],
        approved: false,
        integrationHolderTransferred: false,
      });
      return {
        feature,
        state: "PLANNED",
        integrationHolder: planAuthor,
        epoch: 0,
        branch,
        wave,
        updatedRev: input.rev,
      };
    });
  }

  advanceFeatureLeavesMerged(input: AdvanceLeavesInput): AdvanceLeavesResult {
    requireInt(input.rev, "rev");
    requireInt(input.now, "now");
    requireInt(input.expectedEpoch, "expectedEpoch");
    const feature = requireId(input.feature, "feature");
    return this.inTransaction(() => {
      const row = this.requireFeature(feature);
      this.assertEpoch(row, input.expectedEpoch);
      if (row.state !== "IN_WAVE") {
        return { ok: false, feature, state: row.state, reason: "not_in_wave", epoch: row.epoch };
      }
      const taskCount = this.count(
        `SELECT count(*) AS n FROM task_runtime WHERE feature = :feature`,
        { feature },
      );
      if (taskCount === 0) {
        return { ok: false, feature, state: row.state, reason: "no_tasks", epoch: row.epoch };
      }
      const leafCount = this.count(
        `SELECT count(*) AS n
           FROM task_runtime t
           JOIN nodes n ON n.id = t.task
          WHERE t.feature = :feature
            AND coalesce(n.fields ->> '$.task_type', 'leaf') = 'leaf'`,
        { feature },
      );
      if (leafCount === 0) {
        return { ok: false, feature, state: row.state, reason: "no_leaves", epoch: row.epoch };
      }
      const changed = rowChanges(this.named("advance_feature_leaves_merged").run({ feature, rev: input.rev }));
      if (changed !== 1) {
        return { ok: false, feature, state: "IN_WAVE", reason: "leaves_outstanding", epoch: row.epoch };
      }
      const next = this.requireFeature(feature);
      this.emit("FeatureStateChanged", feature, input.rev, input.now, {
        feature,
        from: "IN_WAVE",
        to: "LEAVES_MERGED",
        epoch: next.epoch,
        integrationHolder: next.integrationHolder,
        rev: input.rev,
        changeSetId: null,
        heldDownstream: [],
        approved: false,
        integrationHolderTransferred: false,
      });
      return { ok: true, feature, state: next.state, reason: "advanced", epoch: next.epoch };
    });
  }

  transitionFeatureState(input: TransitionFeatureInput): FeatureTransitionResult {
    requireInt(input.rev, "rev");
    requireInt(input.now, "now");
    requireInt(input.expectedEpoch, "expectedEpoch");
    const feature = requireId(input.feature, "feature");
    if (!isFeatureState(input.to)) {
      throw new IllegalFeatureTransitionError({
        feature,
        from: null,
        to: String(input.to),
        reason: "unknown feature state",
      });
    }
    return this.inTransaction(() => {
      const row = this.requireFeature(feature);
      this.assertEpoch(row, input.expectedEpoch);
      if (!isLegalFeatureTransition(row.state, input.to)) {
        throw new IllegalFeatureTransitionError({
          feature,
          from: row.state,
          to: input.to,
          reason: "edge is not in FEATURE_STATE_TRANSITIONS",
        });
      }
      if (row.state === "BLOCKED" && input.to !== "DEFERRED" && input.to !== "ABANDONED") {
        const preBlock = this.readPreBlockState(feature);
        if (preBlock !== null) {
          if (input.to !== preBlock) {
            throw new IllegalFeatureTransitionError({
              feature,
              from: row.state,
              to: input.to,
              reason: `BLOCKED feature must resume to its pre-block state ${preBlock}`,
            });
          }
        } else if (
          input.to === "LEAVES_MERGED" ||
          input.to === "WIRED" ||
          input.to === "JOURNEY_PASSED" ||
          input.to === "QUEUED_FOR_MERGE" ||
          input.to === "MERGED"
        ) {
          throw new IllegalFeatureTransitionError({
            feature,
            from: row.state,
            to: input.to,
            reason: `cannot advance directly from BLOCKED to ${input.to} without recorded pre-block state`,
          });
        }
      }
      if (input.to === "DONE") {
        if (!input.evidence || input.evidence.feature !== feature) {
          throw new InvalidLifecycleInputError("DONE requires FeatureDoneEvidenceInput for this feature");
        }
        const result = this.verifyInside(input.evidence);
        if (!result.ok) throw new FeatureDoneRefusedError(result);
      }
      let changeSetId: string | null = null;
      if (input.to === "REOPENED") {
        changeSetId = requireId(input.changeSetId ?? "", "changeSetId");
        this.requireChangeSet(changeSetId);
      }
      if (input.to === "DEFERRED" || input.to === "ABANDONED") {
        if (input.approved !== true) throw new ApprovalRequiredError(feature, input.to);
        const coupled = this.coupledFeatures(feature);
        if (coupled.length > 0) throw new FeatureCoupledError(feature, coupled);
      }
      const nextEpoch = input.to === "REOPENED" ? row.epoch + 1 : row.epoch;
      const nextWave = input.wave === undefined ? row.wave : input.wave;
      if (nextWave !== null) requireInt(nextWave, "wave", 1);
      const updated = this.sql(
        `UPDATE feature_runtime
            SET state = :state, epoch = :epoch, wave = :wave, updated_rev = :rev
          WHERE feature = :feature AND epoch = :expected AND state = :from`,
      ).run({
        state: input.to,
        epoch: nextEpoch,
        wave: nextWave,
        rev: input.rev,
        feature,
        expected: row.epoch,
        from: row.state,
      });
      if (rowChanges(updated) !== 1) {
        throw new StaleEpochError({ feature, expectedEpoch: input.expectedEpoch, actualEpoch: row.epoch });
      }
      if (input.to === "BLOCKED") {
        this.writePreBlockState(feature, row.state);
      } else if (row.state === "BLOCKED") {
        this.clearPreBlockState(feature);
      }
      if (input.to === "DEFERRED" || input.to === "ABANDONED") {
        this.writeApprovedExit(feature, input.to);
      } else if (row.state === "DEFERRED") {
        this.clearApprovedExit(feature);
      }
      const heldDownstream = input.to === "REOPENED" && changeSetId
        ? this.holdDownstream(feature, changeSetId, input.rev, input.now)
        : [];
      const after = this.requireFeature(feature);
      const approved = input.approved === true && (input.to === "DEFERRED" || input.to === "ABANDONED");
      this.emit("FeatureStateChanged", feature, input.rev, input.now, {
        feature,
        from: row.state,
        to: after.state,
        epoch: after.epoch,
        integrationHolder: after.integrationHolder,
        rev: input.rev,
        changeSetId,
        heldDownstream,
        approved,
        integrationHolderTransferred: false,
      });
      if (after.state === "DONE") {
        this.emit("FeatureCompleted", feature, input.rev, input.now, {
          feature,
          epoch: after.epoch,
          rev: input.rev,
          integrationHolder: after.integrationHolder,
        });
      }
      return {
        feature,
        from: row.state,
        to: after.state,
        epoch: after.epoch,
        integrationHolder: after.integrationHolder,
        updatedRev: after.updatedRev,
        heldDownstream,
      };
    });
  }

  verifyFeatureDoneConditions(evidence: FeatureDoneEvidenceInput): FeatureDoneCheckResult {
    const feature = requireId(evidence.feature, "feature");
    if (evidence.feature !== feature) {
      throw new InvalidLifecycleInputError("feature id is blank");
    }
    return this.verifyInside(evidence);
  }

  transferIntegrationHolder(input: TransferHolderInput): TransferHolderResult {
    requireInt(input.rev, "rev");
    requireInt(input.now, "now");
    requireInt(input.expectedEpoch, "expectedEpoch");
    const feature = requireId(input.feature, "feature");
    const nextHolder = requireId(input.nextHolder, "nextHolder");
    return this.inTransaction(() => {
      const row = this.requireFeature(feature);
      this.assertEpoch(row, input.expectedEpoch);
      if (row.integrationHolder === nextHolder) {
        throw new SameIntegrationHolderError(feature, nextHolder);
      }
      const updated = this.sql(
        `UPDATE feature_runtime
            SET integration_holder = :holder, epoch = epoch + 1, updated_rev = :rev
          WHERE feature = :feature AND epoch = :expected`,
      ).run({ holder: nextHolder, rev: input.rev, feature, expected: row.epoch });
      if (rowChanges(updated) !== 1) {
        throw new StaleEpochError({ feature, expectedEpoch: input.expectedEpoch, actualEpoch: row.epoch });
      }
      const after = this.requireFeature(feature);
      this.emit("FeatureStateChanged", feature, input.rev, input.now, {
        feature,
        from: after.state,
        to: after.state,
        epoch: after.epoch,
        integrationHolder: after.integrationHolder,
        previousHolder: row.integrationHolder,
        rev: input.rev,
        changeSetId: null,
        heldDownstream: [],
        approved: false,
        integrationHolderTransferred: true,
      });
      return {
        feature,
        state: after.state,
        previousHolder: row.integrationHolder,
        integrationHolder: nextHolder,
        epoch: after.epoch,
        updatedRev: after.updatedRev,
      };
    });
  }

  transitionProjectState(input: TransitionProjectInput): ProjectTransitionResult {
    requireInt(input.rev, "rev");
    requireInt(input.now, "now");
    return this.inTransaction(() => {
      const row = this.requireProject();
      if (!isProjectState(input.to)) {
        throw new IllegalProjectTransitionError({
          from: row.state,
          to: String(input.to),
          reason: "unknown project state",
        });
      }
      if (!isLegalProjectTransition(row.state, input.to)) {
        throw new IllegalProjectTransitionError({
          from: row.state,
          to: input.to,
          reason: "edge is not in PROJECT_STATE_TRANSITIONS",
        });
      }
      let currentWave = row.currentWave;
      if (input.currentWave !== undefined) {
        if (input.currentWave !== null) requireInt(input.currentWave, "currentWave", 1);
        currentWave = input.currentWave;
      }
      if (input.to === "WAVES" && (currentWave === null || currentWave < 1)) {
        throw new InvalidLifecycleInputError("currentWave is required when entering WAVES");
      }
      if (input.to === "COMPLETION") {
        const blockers = this.completionBlockers();
        if (blockers.length > 0) throw new ProjectCompletionBlockedError(blockers);
      }
      const updated = this.sql(
        `UPDATE project_runtime
            SET state = :state, current_wave = :current_wave, updated_rev = :rev
          WHERE id = 1 AND state = :from`,
      ).run({ state: input.to, current_wave: currentWave, rev: input.rev, from: row.state });
      if (rowChanges(updated) !== 1) {
        throw new ProjectRuntimeMissingError();
      }
      const after = this.requireProject();
      this.emit("ProjectStateChanged", "project", input.rev, input.now, {
        from: row.state,
        to: after.state,
        currentWave: after.currentWave,
        paused: after.paused,
        rev: input.rev,
      });
      return {
        from: row.state,
        to: after.state,
        currentWave: after.currentWave,
        paused: after.paused,
        updatedRev: after.updatedRev,
      };
    });
  }

  setProjectPaused(input: SetProjectPausedInput): ProjectPauseResult {
    requireInt(input.rev, "rev");
    requireInt(input.now, "now");
    if (input.paused !== 0 && input.paused !== 1) {
      throw new InvalidLifecycleInputError("paused must be 0 or 1");
    }
    return this.inTransaction(() => {
      const row = this.requireProject();
      if (row.paused === input.paused) {
        return {
          changed: false,
          state: row.state,
          currentWave: row.currentWave,
          paused: row.paused,
          updatedRev: row.updatedRev,
        };
      }
      const updated = this.sql(
        `UPDATE project_runtime
            SET paused = :paused, updated_rev = :rev
          WHERE id = 1`,
      ).run({ paused: input.paused, rev: input.rev });
      if (rowChanges(updated) !== 1) throw new ProjectRuntimeMissingError();
      const after = this.requireProject();
      if (after.state !== row.state || after.currentWave !== row.currentWave) {
        throw new Error("pause updated project phase");
      }
      this.emit("ProjectPausedChanged", "project", input.rev, input.now, {
        paused: after.paused,
        state: after.state,
        currentWave: after.currentWave,
        rev: input.rev,
      });
      return {
        changed: true,
        state: after.state,
        currentWave: after.currentWave,
        paused: after.paused,
        updatedRev: after.updatedRev,
      };
    });
  }

  listUnlockableFeatures(): readonly string[] {
    if (!this.foundationGatePassed()) return [];
    const rows = this.sql(
      `SELECT feature, state
         FROM feature_runtime
        WHERE state IN ('PLANNED', 'JIT_READY')
        ORDER BY feature`,
    ).all({});
    const unlockable: string[] = [];
    for (const row of rows) {
      const feature = asText(row, "feature");
      if (this.upstreamAllDone(feature)) unlockable.push(feature);
    }
    return unlockable;
  }

  private verifyInside(evidence: FeatureDoneEvidenceInput): FeatureDoneCheckResult {
    const sql = this.queries.get("requirement_status_recompute");
    if (!sql) throw new Error("missing canonical query requirement_status_recompute");
    return evaluateFeatureDoneConditions(this.db, sql, evidence);
  }

  private foundationGatePassed(): boolean {
    const project = this.readProject();
    if (!project) return false;
    if (foundationGatePassedByState(project.state)) return true;
    const meta = this.sql(`SELECT value FROM meta WHERE key = :key`).get({ key: FOUNDATION_GATE_META_KEY });
    return meta !== undefined && asText(meta, "value") === FOUNDATION_GATE_PASSED_VALUE;
  }

  private upstreamAllDone(feature: string): boolean {
    const upstream = this.sql(
      `SELECT e.dst AS upstream
         FROM edges e
         JOIN nodes n ON n.id = e.dst AND n.kind = 'feature'
        WHERE e.src = :feature AND e.type = 'depends_on' AND e.valid_to_rev IS NULL`,
    ).all({ feature });
    for (const row of upstream) {
      const id = asText(row, "upstream");
      const runtime = this.sql(`SELECT state FROM feature_runtime WHERE feature = :feature`).get({ feature: id });
      if (!runtime || asText(runtime, "state") !== "DONE") return false;
    }
    return true;
  }

  private holdDownstream(feature: string, changeSetId: string, rev: number, now: number): string[] {
    const held: string[] = [];
    const seen = new Set<string>([feature]);
    const queue = this.directDownstream(feature);
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next || seen.has(next.feature)) continue;
      seen.add(next.feature);
      for (const further of this.directDownstream(next.feature)) {
        if (!seen.has(further.feature)) queue.push(further);
      }
      if (next.state === "DEFERRED" || next.state === "ABANDONED") continue;
      held.push(next.feature);
      this.sql(
        `INSERT OR IGNORE INTO task_holds(task, reason, source, created_at)
         SELECT t.task, 'requirement_change', :source, :now
           FROM task_runtime t
          WHERE t.feature = :feature`,
      ).run({ source: changeSetId, now, feature: next.feature });
      if (next.state === "PLANNED" || next.state === "JIT_READY" || next.state === "BLOCKED" || next.state === "REOPENED") {
        continue;
      }
      const to: FeatureState = next.state === "DONE" || next.state === "MERGED" ? "REOPENED" : "BLOCKED";
      const epoch = to === "REOPENED" ? next.epoch + 1 : next.epoch;
      const updated = this.sql(
        `UPDATE feature_runtime
            SET state = :state, epoch = :epoch, updated_rev = :rev
          WHERE feature = :feature AND state = :from AND epoch = :expected`,
      ).run({
        state: to,
        epoch,
        rev,
        feature: next.feature,
        from: next.state,
        expected: next.epoch,
      });
      if (rowChanges(updated) !== 1) continue;
      if (to === "BLOCKED") {
        this.writePreBlockState(next.feature, next.state);
      }
      const after = this.requireFeature(next.feature);
      this.emit("FeatureStateChanged", next.feature, rev, now, {
        feature: next.feature,
        from: next.state,
        to: after.state,
        epoch: after.epoch,
        integrationHolder: after.integrationHolder,
        rev,
        changeSetId,
        heldDownstream: [],
        approved: false,
        integrationHolderTransferred: false,
        heldBecause: feature,
      });
    }
    held.sort();
    return held;
  }

  private directDownstream(upstream: string): DownstreamHit[] {
    const rows = this.sql(
      `SELECT fr.feature AS feature, fr.state AS state, fr.epoch AS epoch
         FROM edges e
         JOIN nodes n ON n.id = e.src AND n.kind = 'feature'
         JOIN feature_runtime fr ON fr.feature = e.src
        WHERE e.dst = :upstream
          AND e.type = 'depends_on'
          AND e.valid_to_rev IS NULL
          AND e.src <> :upstream`,
    ).all({ upstream });
    const hits: DownstreamHit[] = [];
    for (const row of rows) {
      const state = asText(row, "state");
      if (!isFeatureState(state)) continue;
      hits.push({ feature: asText(row, "feature"), state, epoch: asInt(row, "epoch") });
    }
    return hits;
  }

  private completionBlockers(): CompletionBlocker[] {
    const rows = this.sql(`SELECT feature, state FROM feature_runtime ORDER BY feature`).all({});
    const blockers: CompletionBlocker[] = [];
    for (const row of rows) {
      const feature = asText(row, "feature");
      const state = asText(row, "state");
      if (state === "DONE") continue;
      if (state === "DEFERRED" || state === "ABANDONED") {
        if (!this.approvedExit(feature, state)) {
          blockers.push({ feature, state, reason: "not_approved" });
          continue;
        }
        if (this.coupledFeatures(feature).length > 0) {
          blockers.push({ feature, state, reason: "coupled" });
          continue;
        }
        continue;
      }
      blockers.push({ feature, state, reason: "active" });
    }
    return blockers;
  }

  private approvedExit(feature: string, state: string): boolean {
    const row = this.sql(`SELECT value FROM meta WHERE key = :key`).get({
      key: approvedExitMetaKey(feature),
    });
    return row !== undefined && asText(row, "value") === state;
  }

  private writeApprovedExit(feature: string, state: "DEFERRED" | "ABANDONED"): void {
    this.sql(
      `INSERT INTO meta(key, value) VALUES (:key, :value)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run({ key: approvedExitMetaKey(feature), value: state });
  }

  private clearApprovedExit(feature: string): void {
    this.sql(`DELETE FROM meta WHERE key = :key`).run({ key: approvedExitMetaKey(feature) });
  }

  private readPreBlockState(feature: string): FeatureState | null {
    const row = this.sql(`SELECT value FROM meta WHERE key = :key`).get({
      key: preBlockMetaKey(feature),
    });
    if (!row) return null;
    const value = asText(row, "value");
    return isFeatureState(value) ? value : null;
  }

  private writePreBlockState(feature: string, from: FeatureState): void {
    this.sql(
      `INSERT INTO meta(key, value) VALUES (:key, :value)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run({ key: preBlockMetaKey(feature), value: from });
  }

  private clearPreBlockState(feature: string): void {
    this.sql(`DELETE FROM meta WHERE key = :key`).run({ key: preBlockMetaKey(feature) });
  }

  private coupledFeatures(feature: string): CoupledFeatureRef[] {
    const rows = this.sql(
      `SELECT o.id AS other, fr.state AS state
         FROM edges e
         JOIN nodes o ON o.kind = 'feature'
          AND o.id = CASE WHEN e.src = :feature THEN e.dst ELSE e.src END
         JOIN feature_runtime fr ON fr.feature = o.id
        WHERE e.type = 'depends_on'
          AND e.valid_to_rev IS NULL
          AND (e.src = :feature OR e.dst = :feature)
          AND o.id <> :feature
          AND fr.state NOT IN ('DONE', 'DEFERRED', 'ABANDONED')`,
    ).all({ feature });
    return rows.map((row) => ({ feature: asText(row, "other"), state: asText(row, "state") }));
  }

  private requireChangeSet(changeSetId: string): void {
    const row = this.sql(`SELECT 1 AS ok FROM change_sets WHERE id = :id`).get({ id: changeSetId });
    if (!row) throw new ChangeSetNotFoundError(changeSetId);
  }

  private assertEpoch(row: FeatureRow, expectedEpoch: number): void {
    if (row.epoch !== expectedEpoch) {
      throw new StaleEpochError({
        feature: row.feature,
        expectedEpoch,
        actualEpoch: row.epoch,
      });
    }
  }

  private requireFeature(feature: string): FeatureRow {
    const row = this.readFeature(feature);
    if (!row) throw new FeatureNotFoundError(feature);
    return row;
  }

  private readFeature(feature: string): FeatureRow | null {
    const row = this.sql(
      `SELECT feature, state, wave, integration_holder, epoch, branch, updated_rev
         FROM feature_runtime WHERE feature = :feature`,
    ).get({ feature });
    if (!row) return null;
    const state = asText(row, "state");
    if (!isFeatureState(state)) {
      throw new IllegalFeatureTransitionError({
        feature,
        from: null,
        to: state,
        reason: "stored feature state is not in FEATURE_STATES",
      });
    }
    return {
      feature: asText(row, "feature"),
      state,
      wave: asNullableInt(row, "wave"),
      integrationHolder: asNullableText(row, "integration_holder"),
      epoch: asInt(row, "epoch"),
      branch: asNullableText(row, "branch"),
      updatedRev: asInt(row, "updated_rev"),
    };
  }

  private requireProject(): ProjectRow {
    const row = this.readProject();
    if (!row) throw new ProjectRuntimeMissingError();
    return row;
  }

  private readProject(): ProjectRow | null {
    const row = this.sql(
      `SELECT state, current_wave, paused, updated_rev FROM project_runtime WHERE id = 1`,
    ).get({});
    if (!row) return null;
    const state = asText(row, "state");
    if (!isProjectState(state)) {
      throw new IllegalProjectTransitionError({
        from: "DISCOVERY",
        to: state,
        reason: "stored project state is not in PROJECT_STATES",
      });
    }
    const paused = asInt(row, "paused");
    if (paused !== 0 && paused !== 1) {
      throw new InvalidLifecycleInputError("project_runtime.paused is not 0 or 1");
    }
    return {
      state,
      currentWave: asNullableInt(row, "current_wave"),
      paused,
      updatedRev: asInt(row, "updated_rev"),
    };
  }

  private count(sql: string, params: Readonly<Record<string, SqlValue>>): number {
    const row = this.sql(sql).get(params);
    if (!row) return 0;
    return asInt(row, "n");
  }

  private emit(
    type: LifecycleEventType,
    subject: string,
    rev: number,
    now: number,
    payload: Readonly<Record<string, unknown>>,
  ): void {
    if (!LIFECYCLE_EVENT_TYPES.includes(type)) {
      throw new Error(`unknown lifecycle event ${type}`);
    }
    if (type === "FeatureCompleted") {
      const feature = payload.feature;
      if (typeof feature !== "string") {
        throw new Error("FeatureCompleted requires a feature id");
      }
    }
    const eventId = randomUUID();
    this.sql(
      `INSERT INTO outbox(id, type, subject, rev, payload, created_at)
       VALUES (:id, :type, :subject, :rev, :payload, :created_at)`,
    ).run({
      id: eventId,
      type,
      subject,
      rev,
      payload: JSON.stringify(payload),
      created_at: now,
    });
    for (const consumer of LIFECYCLE_EVENT_CONSUMERS) {
      this.named("register_delivery").run({ event_id: eventId, consumer });
    }
  }

  private named(name: string): SqlStatement {
    const sql = this.queries.get(name);
    if (!sql) throw new Error(`missing canonical query ${name}`);
    return this.sql(sql);
  }

  private sql(text: string): SqlStatement {
    const cached = this.statements.get(text);
    if (cached) return cached;
    const statement = this.db.prepare(text);
    this.statements.set(text, statement);
    return statement;
  }

  private inTransaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch (rollbackError) {
        const message = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
        throw new Error(`rollback failed after ${error instanceof Error ? error.message : String(error)}: ${message}`);
      }
      throw error;
    }
  }
}

function approvedExitMetaKey(feature: string): string {
  return `feature_exit_approved:${feature}`;
}

function preBlockMetaKey(feature: string): string {
  return `feature_pre_block_state:${feature}`;
}

function requireId(value: string, label: string): string {
  if (value.trim().length === 0) {
    throw new InvalidLifecycleInputError(`${label} must be non-empty`);
  }
  return value;
}

export function createLifecycleRepo(
  connection: StateConnection,
  queries: ReadonlyMap<string, string> = loadCanonicalQueries(),
): LifecycleRepo {
  return new LifecycleRepo(connection, queries);
}
