import path from "node:path";
import { computeNodeContentHash, type ProjectStateDb } from "@ef-harness/db";
import { openPlannerState, tempPlannerRoot } from "../state/project-db.js";
import {
  BudgetReservationError,
  CompiledPlanMissingError,
  type AttemptReceipt,
  type CompiledFeatureSpec,
  type CompiledLeafSpec,
  type RequirementBasis,
  type TaskFields,
} from "./types.js";

type SqlValue = string | number | bigint | null | Uint8Array;
type SqlRow = Record<string, SqlValue>;

const NAMED_QUERIES = [
  "claim_task",
  "create_attempt",
  "reserve",
  "settle",
  "settle_mark",
  "release",
  "accept_submission",
  "finish_submission",
  "submit_candidate",
  "record_hidden_failure",
  "advance_feature_leaves_merged",
] as const;

type NamedQuery = (typeof NAMED_QUERIES)[number];
type Writer = ProjectStateDb["writer"];
type SqlStatement = ReturnType<Writer["prepare"]>;

export interface LeafDraft {
  id: string;
  feature: string;
  title: string;
  text?: string;
  basis: RequirementBasis;
  tags?: string[];
  criticalPath?: boolean;
  phase?: string;
  dependsOn?: readonly string[];
  snapshotId?: string | null;
  level?: string;
  state?: string;
}

export class StateDb {
  readonly state: ProjectStateDb;
  readonly writer: Writer;
  readonly raw: {
    prepare(sql: string): {
      all(...args: unknown[]): SqlRow[];
      get(...args: unknown[]): SqlRow | undefined;
    };
  };
  private readonly queries: Record<NamedQuery, SqlStatement>;
  private revCounter: number;
  private depth = 0;

  constructor(state: ProjectStateDb) {
    this.state = state;
    this.writer = state.writer;
    this.raw = {
      prepare: (sql: string) => {
        const statement = this.writer.prepare(sql);
        return {
          all: (...args: unknown[]) => statement.all(positional(args)).flatMap((row: unknown) => (isRow(row) ? [row] : [])),
          get: (...args: unknown[]) => {
            const row = statement.get(positional(args));
            return isRow(row) ? row : undefined;
          },
        };
      },
    };
    const queries = {} as Record<NamedQuery, SqlStatement>;
    for (const name of NAMED_QUERIES) {
      queries[name] = this.writer.prepare(this.state.query(name));
    }
    this.queries = queries;
    const row = this.one("SELECT COALESCE(MAX(updated_rev), 0) AS n FROM task_runtime");
    this.revCounter = row ? numberValue(row.n) : 0;
  }

  static open(filename = ":memory:"): StateDb {
    const root = filename === ":memory:" ? tempPlannerRoot("ef-seq-") : path.dirname(filename);
    return new StateDb(openPlannerState(root));
  }

  close(): void {
    this.state.close();
  }

  transaction<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    this.depth += 1;
    try {
      const value = this.writer.transaction(() => fn());
      this.depth -= 1;
      return value;
    } catch (error) {
      this.depth -= 1;
      throw error;
    }
  }

  bumpRev(): number {
    this.revCounter += 1;
    return this.revCounter;
  }

  ensureProject(input: { wave: number; gate0: "PASSED" | "PENDING" }): void {
    this.transaction(() => {
      const existing = this.one("SELECT id FROM project_runtime WHERE id = 1");
      if (!existing) {
        this.run(
          "INSERT INTO project_runtime(id, state, current_wave, paused, updated_rev) VALUES (1, 'WAVES', ?, 0, ?)",
          input.wave,
          this.bumpRev(),
        );
      } else {
        this.run(
          "UPDATE project_runtime SET state = 'WAVES', current_wave = ?, updated_rev = ? WHERE id = 1",
          input.wave,
          this.bumpRev(),
        );
      }
      this.run(
        `INSERT INTO meta(key, value) VALUES ('gate0', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        input.gate0,
      );
    });
  }

  setGate0(value: "PASSED" | "PENDING"): void {
    this.run(
      `INSERT INTO meta(key, value) VALUES ('gate0', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      value,
    );
  }

  gate0(): string {
    const row = this.one("SELECT value FROM meta WHERE key = 'gate0'");
    return row ? String(row.value) : "PENDING";
  }

  currentWave(): number {
    const row = this.one("SELECT current_wave AS n FROM project_runtime WHERE id = 1");
    if (!row || row.n === null) return 0;
    return numberValue(row.n);
  }

  setCurrentWave(wave: number): void {
    this.run("UPDATE project_runtime SET current_wave = ?, updated_rev = ? WHERE id = 1", wave, this.bumpRev());
  }

  addFeature(input: { id: string; title: string; wave: number; branch: string; state?: string }): void {
    this.transaction(() => {
      const rev = this.changeSet(`feature ${input.id}`);
      this.insertNode({
        id: input.id,
        kind: "feature",
        title: input.title,
        text: input.title,
        fields: { feature: input.id },
        rev,
      });
      this.run(
        `INSERT INTO feature_runtime(feature, state, wave, branch, updated_rev)
         VALUES (?, ?, ?, ?, ?)`,
        input.id,
        input.state ?? "IN_WAVE",
        input.wave,
        input.branch,
        rev,
      );
    });
  }

  addJourney(featureId: string, id: string): void {
    this.transaction(() => {
      const rev = this.changeSet(`journey ${id}`);
      this.insertNode({
        id,
        kind: "journey",
        title: id,
        text: id,
        fields: { feature: featureId },
        rev,
      });
      this.run(
        `INSERT INTO requirement_status(requirement, feature, status, updated_rev) VALUES (?, ?, 'passing', ?)`,
        id,
        featureId,
        rev,
      );
    });
  }

  addLeafTask(input: LeafDraft): void {
    this.transaction(() => {
      const rev = this.changeSet(`task ${input.id}`);
      const requirementId = `R-${input.id}`;
      this.insertNode({
        id: requirementId,
        kind: "spec_item",
        title: `${input.title} requirement`,
        text: input.text ?? input.title,
        fields: { feature: input.feature, basis: input.basis },
        rev,
      });
      const fields: TaskFields = {
        feature: input.feature,
        basis: input.basis,
        tags: input.tags ? [...input.tags] : [],
        task_type: "leaf",
        critical_path: input.criticalPath === true,
      };
      if (input.phase) fields.phase = input.phase;
      if (input.level) fields.level = input.level;
      if (input.snapshotId !== null) {
        fields.compiled_plan_snapshot = {
          snapshotId: input.snapshotId ?? `snap-${input.id}`,
          compiler: "DeterministicGraphCompiler",
        };
      }
      this.insertNode({
        id: input.id,
        kind: "task",
        title: input.title,
        text: input.text ?? input.title,
        fields,
        rev,
      });
      this.insertEdge(input.id, "implements", requirementId, rev);
      for (const dependency of input.dependsOn ?? []) {
        this.insertEdge(input.id, "depends_on", dependency, rev);
      }
      this.run(
        `INSERT INTO task_runtime(task, feature, state, level, updated_rev) VALUES (?, ?, ?, ?, ?)`,
        input.id,
        input.feature,
        input.state ?? "READY",
        input.level ?? "mid",
        rev,
      );
      this.run(
        `INSERT OR IGNORE INTO budgets(scope_kind, scope_id, currency, limit_units)
         VALUES ('task', ?, 'usd', 1000000)`,
        input.id,
      );
    });
  }

  installWave(features: readonly CompiledFeatureSpec[], tasks: readonly CompiledLeafSpec[]): void {
    for (const feature of features) {
      this.addFeature({ id: feature.id, title: feature.title, wave: feature.wave, branch: feature.branch });
    }
    const pending = [...tasks];
    const inserted = new Set<string>();
    while (pending.length > 0) {
      const index = pending.findIndex((task) =>
        (task.dependsOn ?? []).every((dependency) => inserted.has(dependency) || !pending.some((item) => item.id === dependency)),
      );
      const task = pending[index >= 0 ? index : 0];
      if (!task) break;
      pending.splice(index >= 0 ? index : 0, 1);
      inserted.add(task.id);
      this.addLeafTask({
        id: task.id,
        feature: task.feature,
        title: task.title,
        ...(task.text ? { text: task.text } : {}),
        basis: task.basis,
        ...(task.tags ? { tags: task.tags } : {}),
        ...(task.criticalPath ? { criticalPath: true } : {}),
        ...(task.phase ? { phase: task.phase } : {}),
        ...(task.dependsOn ? { dependsOn: task.dependsOn } : {}),
        snapshotId: task.snapshotId,
        ...(task.level ? { level: task.level } : {}),
      });
    }
  }

  addHold(taskId: string, reason: string, source: string, now: number): void {
    this.run(
      "INSERT INTO task_holds(task, reason, source, created_at) VALUES (?, ?, ?, ?)",
      taskId,
      reason,
      source,
      now,
    );
  }

  releaseHold(taskId: string): void {
    this.run("DELETE FROM task_holds WHERE task = ?", taskId);
  }

  hasActiveHold(taskId: string): boolean {
    const row = this.one("SELECT COUNT(*) AS n FROM task_holds WHERE task = ?", taskId);
    return row ? numberValue(row.n) > 0 : false;
  }

  gatePassed(): boolean {
    return this.gate0() === "PASSED";
  }

  dependencyEdges(): Array<{ src: string; dst: string }> {
    return this.all(
      `SELECT src, dst FROM edges
        WHERE type = 'depends_on' AND valid_to_rev IS NULL`,
    ).map((row) => ({ src: String(row.src), dst: String(row.dst) }));
  }

  requirementBases(taskId: string): string[] {
    return this.all(
      `SELECT n.basis AS basis
         FROM edges e
         JOIN nodes n ON n.id = e.dst
        WHERE e.src = ? AND e.type = 'implements' AND e.valid_to_rev IS NULL
          AND n.basis IS NOT NULL`,
      taskId,
    ).map((row) => String(row.basis));
  }

  readyRows(): SqlRow[] {
    return this.all(
      `SELECT t.task AS task, t.feature AS feature, t.level AS level, t.state AS state,
              n.version AS version, n.content_hash AS content_hash, n.title AS title, n.text AS text,
              n.fields AS fields, f.state AS feature_state, f.wave AS wave, f.branch AS branch
         FROM task_runtime t
         JOIN nodes n ON n.id = t.task
         JOIN feature_runtime f ON f.feature = t.feature
        WHERE t.state = 'READY'
          AND f.state = 'IN_WAVE'
          AND NOT EXISTS (SELECT 1 FROM task_holds h WHERE h.task = t.task)
          AND NOT EXISTS (
            SELECT 1
              FROM edges d
              JOIN task_runtime dep ON dep.task = d.dst
              JOIN task_states s ON s.state = dep.state
             WHERE d.src = t.task AND d.type = 'depends_on' AND d.valid_to_rev IS NULL
               AND s.done = 0
          )`,
    );
  }

  openBlockers(taskId: string): boolean {
    const row = this.one(
      `SELECT COUNT(*) AS n
         FROM edges e
         JOIN task_runtime dep ON dep.task = e.src
         JOIN task_states s ON s.state = dep.state
        WHERE e.dst = ? AND e.type = 'depends_on' AND e.valid_to_rev IS NULL
          AND s.done = 0`,
      taskId,
    );
    return row ? numberValue(row.n) > 0 : false;
  }

  waitingOnUser(): boolean {
    const row = this.one(
      `SELECT COUNT(*) AS n FROM task_runtime
        WHERE state = 'WAITING_INPUT'
           OR task IN (SELECT task FROM task_holds)`,
    );
    return row ? numberValue(row.n) > 0 : false;
  }

  taskFields(taskId: string): TaskFields {
    const row = this.one("SELECT fields FROM nodes WHERE id = ?", taskId);
    if (!row) return {};
    return parseFields(String(row.fields));
  }

  claim(input: {
    taskId: string;
    expectedBrief: number;
    baseCommit: string;
    now: number;
    amount: number;
    leaseMs: number;
  }): { attemptId: string; epoch: number; reservationId: string } | null {
    const fields = this.taskFields(input.taskId);
    const snapshot = fields.compiled_plan_snapshot;
    if (!snapshot || typeof snapshot.snapshotId !== "string" || snapshot.snapshotId.length === 0) {
      throw new CompiledPlanMissingError(input.taskId);
    }
    const attemptId = this.nextAttemptId(input.taskId);
    const reservationId = `rsv-${attemptId}`;
    return this.transaction(() => {
      const claimed = this.queries.claim_task.all({
        task: input.taskId,
        attempt: attemptId,
        expires_at: input.now + input.leaseMs,
        rev: this.bumpRev(),
        expected_brief: input.expectedBrief,
      }) as SqlRow[];
      const first = claimed[0];
      if (!first) return null;
      const epoch = numberValue(first.epoch);
      this.queries.create_attempt.run({
        attempt: attemptId,
        task: input.taskId,
        epoch,
        expected_brief: input.expectedBrief,
        runtime: "native",
        model: "fake-worker",
        connection: "local",
        base_commit: input.baseCommit,
        now: input.now,
      });
      this.run(
        `INSERT INTO reservations(id, attempt, purpose, currency, amount_units, state, created_at)
         VALUES (?, ?, 'model_call', 'usd', ?, 'held', ?)`,
        reservationId,
        attemptId,
        input.amount,
        input.now,
      );
      this.run(
        `INSERT INTO reservation_scopes(reservation, scope_kind, scope_id, currency)
         VALUES (?, 'task', ?, 'usd')`,
        reservationId,
        input.taskId,
      );
      const reserved = this.queries.reserve.run({ reservation: reservationId, amount: input.amount });
      if (changed(reserved) !== 1) throw new BudgetReservationError(input.taskId);
      return { attemptId, epoch, reservationId };
    });
  }

  nextAttemptId(taskId: string): string {
    const row = this.one("SELECT COUNT(*) AS n FROM attempts WHERE task = ?", taskId);
    const n = (row ? numberValue(row.n) : 0) + 1;
    return `A-${taskId}-${n}`;
  }

  markCoding(taskId: string, attemptId: string): void {
    this.run(
      `UPDATE task_runtime SET state = 'CODING', updated_rev = ?
        WHERE task = ? AND holder_attempt = ? AND state = 'LEASED'`,
      this.bumpRev(),
      taskId,
      attemptId,
    );
  }

  beginVerification(taskId: string, attemptId: string, epoch: number): void {
    this.queries.accept_submission.run({
      task: taskId,
      attempt: attemptId,
      epoch,
      rev: this.bumpRev(),
    });
  }

  markCleanVerify(taskId: string, epoch: number): void {
    this.run(
      `UPDATE task_runtime SET state = 'CLEAN_VERIFY', updated_rev = ?
        WHERE task = ? AND epoch = ? AND submission_pending = 1`,
      this.bumpRev(),
      taskId,
      epoch,
    );
  }

  submissionPending(taskId: string): number {
    const row = this.one("SELECT submission_pending AS n FROM task_runtime WHERE task = ?", taskId);
    return row ? numberValue(row.n) : 0;
  }

  taskState(taskId: string): string {
    const row = this.one("SELECT state FROM task_runtime WHERE task = ?", taskId);
    return row ? String(row.state) : "";
  }

  finish(taskId: string, epoch: number, nextState: string): void {
    this.queries.finish_submission.run({
      task: taskId,
      epoch,
      next_state: nextState,
      rev: this.bumpRev(),
    });
  }

  releaseToReady(taskId: string, attemptId: string, now: number, outcome: string): void {
    this.transaction(() => {
      this.run(
        `UPDATE attempts SET state = 'rejected', ended_at = ?, outcome = ? WHERE id = ?`,
        now,
        outcome,
        attemptId,
      );
      this.run(
        `UPDATE task_runtime
            SET state = 'READY', holder_attempt = NULL, lease_expires_at = NULL,
                submission_pending = 0, updated_rev = ?
          WHERE task = ?`,
        this.bumpRev(),
        taskId,
      );
    });
  }

  park(taskId: string, attemptId: string, now: number): void {
    this.transaction(() => {
      this.run(
        `UPDATE attempts SET state = 'parked', ended_at = ?, outcome = 'stopped' WHERE id = ?`,
        now,
        attemptId,
      );
      this.run(
        `UPDATE task_runtime
            SET state = 'PARKED', holder_attempt = NULL, lease_expires_at = NULL,
                submission_pending = 0, updated_rev = ?
          WHERE task = ?`,
        this.bumpRev(),
        taskId,
      );
    });
  }

  suspendCoding(taskId: string, attemptId: string): void {
    this.run(
      `UPDATE attempts SET outcome = 'suspended' WHERE id = ?`,
      attemptId,
    );
    this.run(
      `UPDATE task_runtime SET state = 'CODING', updated_rev = ?
        WHERE task = ? AND holder_attempt = ?`,
      this.bumpRev(),
      taskId,
      attemptId,
    );
  }

  escalate(taskId: string, attemptId: string, epoch: number, now: number, outcome: string): void {
    this.transaction(() => {
      const pending = this.submissionPending(taskId);
      if (pending === 1) {
        this.finish(taskId, epoch, "ESCALATED");
      } else {
        this.run(
          `UPDATE task_runtime
              SET state = 'ESCALATED', holder_attempt = NULL, lease_expires_at = NULL,
                  submission_pending = 0, updated_rev = ?
            WHERE task = ?`,
          this.bumpRev(),
          taskId,
        );
      }
      this.run(
        `UPDATE attempts SET state = 'rejected', ended_at = ?, outcome = ? WHERE id = ?`,
        now,
        outcome,
        attemptId,
      );
    });
  }

  recordHiddenFailure(taskId: string, briefVersion: number, fingerprint: string, now: number): number {
    const row = this.queries.record_hidden_failure.get({
      task: taskId,
      brief_version: briefVersion,
      fingerprint,
      now,
    }) as SqlRow | undefined;
    if (!row) return 1;
    return numberValue(row.ladder_step);
  }

  ladderStep(taskId: string): number {
    const row = this.one("SELECT ladder_step AS n FROM verification_state WHERE task = ?", taskId);
    return row ? numberValue(row.n) : 0;
  }

  bumpStaticFailure(taskId: string, briefVersion: number, now: number): number {
    return this.transaction(() => {
      const existing = this.one("SELECT static_failures AS n FROM verification_state WHERE task = ?", taskId);
      if (!existing) {
        this.run(
          `INSERT INTO verification_state(task, brief_version, ladder_step, static_failures, updated_at)
           VALUES (?, ?, 0, 1, ?)`,
          taskId,
          briefVersion,
          now,
        );
        return 1;
      }
      const next = numberValue(existing.n) + 1;
      this.run(
        `UPDATE verification_state SET static_failures = ?, brief_version = ?, updated_at = ? WHERE task = ?`,
        next,
        briefVersion,
        now,
        taskId,
      );
      return next;
    });
  }

  staticFailures(taskId: string): number {
    const row = this.one("SELECT static_failures AS n FROM verification_state WHERE task = ?", taskId);
    return row ? numberValue(row.n) : 0;
  }

  writeCheckpoint(input: {
    attemptId: string;
    step: number;
    wipRef: string | null;
    manifestJson: string;
    briefText: string;
    now: number;
  }): void {
    this.run(
      `INSERT INTO attempt_checkpoints(
         attempt, step, wip_ref, session_ref, contract_versions, pending_effects, handoff_artifact, updated_at
       ) VALUES (?, ?, ?, NULL, ?, '[]', ?, ?)
       ON CONFLICT(attempt) DO UPDATE SET
         step = excluded.step,
         wip_ref = COALESCE(excluded.wip_ref, attempt_checkpoints.wip_ref),
         contract_versions = excluded.contract_versions,
         handoff_artifact = excluded.handoff_artifact,
         updated_at = excluded.updated_at`,
      input.attemptId,
      input.step,
      input.wipRef,
      input.manifestJson,
      input.briefText,
      input.now,
    );
  }

  checkpointJson(attemptId: string): string | null {
    const row = this.one("SELECT contract_versions AS json FROM attempt_checkpoints WHERE attempt = ?", attemptId);
    if (!row || row.json === null) return null;
    return String(row.json);
  }

  insertCandidate(input: {
    id: string;
    taskId: string;
    attemptId: string;
    epoch: number;
    commitSha: string;
    payload: string;
    now: number;
  }): boolean {
    const result = this.queries.submit_candidate.run({
      candidate: input.id,
      task: input.taskId,
      attempt: input.attemptId,
      epoch: input.epoch,
      commit_sha: input.commitSha,
      payload: input.payload,
      now: input.now,
    });
    return changed(result) === 1;
  }

  candidateCount(taskId: string): number {
    const row = this.one("SELECT COUNT(*) AS n FROM candidates WHERE task = ?", taskId);
    return row ? numberValue(row.n) : 0;
  }

  markAccepted(taskId: string, attemptId: string, epoch: number, now: number): void {
    this.transaction(() => {
      this.finish(taskId, epoch, "ACCEPTED");
      this.run(
        `UPDATE attempts SET state = 'accepted', ended_at = ?, outcome = 'accepted' WHERE id = ?`,
        now,
        attemptId,
      );
    });
  }

  markMerged(taskId: string, attemptId: string, now: number): void {
    this.transaction(() => {
      this.run(
        `UPDATE task_runtime
            SET state = 'MERGED_TO_FEATURE', holder_attempt = NULL, lease_expires_at = NULL,
                submission_pending = 0, updated_rev = ?
          WHERE task = ? AND state = 'ACCEPTED'`,
        this.bumpRev(),
        taskId,
      );
      this.run(
        `UPDATE attempts SET state = 'accepted', ended_at = ?, outcome = 'merged' WHERE id = ?`,
        now,
        attemptId,
      );
      this.passRequirements(taskId);
    });
  }

  closeReservation(reservationId: string, now: number, actual: number, settle: boolean): void {
    if (settle) {
      this.queries.settle.run({ reservation: reservationId, actual });
      this.queries.settle_mark.run({ reservation: reservationId, actual, now });
      return;
    }
    this.queries.release.run({ reservation: reservationId });
    this.run(
      `UPDATE reservations SET state = 'released', settled_at = ? WHERE id = ? AND state = 'held'`,
      now,
      reservationId,
    );
  }

  saveReceipt(receipt: AttemptReceipt, now: number): void {
    const id = `RCPT-${receipt.attemptId}`;
    const fields = {
      record: "attempt_receipt",
      attemptId: receipt.attemptId,
      task: receipt.taskId,
      claimedAt: receipt.claimedAt,
      briefTokens: receipt.briefTokens,
      workerTurns: receipt.workerTurns,
      costMicroUsd: receipt.costMicroUsd,
      verifierVerdict: receipt.verifierVerdict,
      mergedCommitSha: receipt.mergedCommitSha,
      smokeMs: receipt.smokeMs,
      phase: receipt.phase,
      hintStep: receipt.hintStep,
      staticAudit: receipt.staticAudit,
      detail: receipt.detail,
      updatedAt: now,
    };
    const existing = this.one("SELECT version FROM nodes WHERE id = ?", id);
    if (!existing) {
      const rev = this.changeSet(`receipt ${receipt.attemptId}`);
      this.insertNode({ id, kind: "comment", title: receipt.attemptId, text: receipt.detail, fields, rev });
      return;
    }
    const version = numberValue(existing.version) + 1;
    const hash = computeNodeContentHash({ kind: "comment", title: receipt.attemptId, text: receipt.detail, fields });
    const changeSet = this.changeSet(`receipt ${receipt.attemptId}`);
    this.run(
      `UPDATE nodes
          SET version = ?, content_hash = ?, title = ?, text = ?, fields = ?, change_set = ?, updated_rev = ?
        WHERE id = ?`,
      version,
      hash,
      receipt.attemptId,
      receipt.detail,
      JSON.stringify(fields),
      `CS-${changeSet}`,
      changeSet,
      id,
    );
  }

  receiptsFor(taskId: string): AttemptReceipt[] {
    return this.all(
      `SELECT fields
         FROM nodes
        WHERE kind = 'comment'
          AND status = 'active'
          AND json_extract(fields, '$.record') = 'attempt_receipt'
          AND json_extract(fields, '$.task') = ?
        ORDER BY json_extract(fields, '$.claimedAt'), id`,
      taskId,
    ).map((row) => receiptFromFields(String(row.fields)));
  }

  pinnedNodes(taskId: string): Array<{ id: string; version: number; contentHash: string }> {
    const rows = this.all(
      `SELECT n.id AS id, n.version AS version, n.content_hash AS content_hash
         FROM nodes n
        WHERE n.id = ?
           OR n.id IN (
             SELECT e.dst FROM edges e
              WHERE e.src = ? AND e.type = 'implements' AND e.valid_to_rev IS NULL
           )
        ORDER BY n.id`,
      taskId,
      taskId,
    );
    return rows.map((row) => ({
      id: String(row.id),
      version: numberValue(row.version),
      contentHash: String(row.content_hash),
    }));
  }

  requirementLines(taskId: string): string[] {
    return this.all(
      `SELECT n.title AS title, n.basis AS basis, n.text AS text
         FROM edges e
         JOIN nodes n ON n.id = e.dst
        WHERE e.src = ? AND e.type = 'implements' AND e.valid_to_rev IS NULL
        ORDER BY n.id`,
      taskId,
    ).map((row) => `${String(row.title)} (${String(row.basis)}): ${String(row.text)}`);
  }

  advanceLeavesMerged(featureId: string): boolean {
    const result = this.queries.advance_feature_leaves_merged.run({
      feature: featureId,
      rev: this.bumpRev(),
    });
    return changed(result) === 1;
  }

  featuresInState(states: readonly string[]): Array<{ id: string; state: string; wave: number; branch: string }> {
    const marks = states.map(() => "?").join(", ");
    return this.all(
      `SELECT feature AS id, state, wave, branch FROM feature_runtime WHERE state IN (${marks}) ORDER BY feature`,
      ...states,
    ).map((row) => ({
      id: String(row.id),
      state: String(row.state),
      wave: numberValue(row.wave),
      branch: String(row.branch),
    }));
  }

  featuresInWave(wave: number): Array<{ id: string; state: string; branch: string }> {
    return this.all(
      `SELECT feature AS id, state, branch FROM feature_runtime WHERE wave = ? ORDER BY feature`,
      wave,
    ).map((row) => ({ id: String(row.id), state: String(row.state), branch: String(row.branch) }));
  }

  setFeatureState(featureId: string, state: string): void {
    this.run(
      "UPDATE feature_runtime SET state = ?, updated_rev = ? WHERE feature = ?",
      state,
      this.bumpRev(),
      featureId,
    );
  }

  featureHasPhase0(featureId: string): boolean {
    const row = this.one(
      `SELECT COUNT(*) AS n
         FROM task_runtime t
         JOIN nodes n ON n.id = t.task
        WHERE t.feature = ?
          AND json_extract(n.fields, '$.phase') = 'phase0'`,
      featureId,
    );
    return row ? numberValue(row.n) > 0 : false;
  }

  featureHeadTasksMerged(featureId: string): boolean {
    const row = this.one(
      `SELECT COUNT(*) AS n
         FROM task_runtime t
         JOIN nodes n ON n.id = t.task
        WHERE t.feature = ?
          AND coalesce(json_extract(n.fields, '$.task_type'), 'leaf') = 'leaf'
          AND t.state NOT IN ('MERGED_TO_FEATURE', 'CANCELLED', 'SUPERSEDED')`,
      featureId,
    );
    return row ? numberValue(row.n) === 0 : false;
  }

  unmetRequirements(featureId: string): string[] {
    return this.all(
      `SELECT r.id AS id
         FROM requirements r
         LEFT JOIN requirement_status s ON s.requirement = r.id
        WHERE r.feature = ?
          AND COALESCE(s.status, 'uncovered') NOT IN ('passing', 'waived')`,
      featureId,
    ).map((row) => String(row.id));
  }

  staticAuditClean(featureId: string): boolean {
    const row = this.one(
      `SELECT COUNT(*) AS n
         FROM task_runtime t
        WHERE t.feature = ?
          AND t.state = 'MERGED_TO_FEATURE'
          AND NOT EXISTS (
            SELECT 1 FROM nodes r
             WHERE r.kind = 'comment'
               AND r.status = 'active'
               AND json_extract(r.fields, '$.record') = 'attempt_receipt'
               AND json_extract(r.fields, '$.task') = t.task
               AND json_extract(r.fields, '$.staticAudit') = 'pass'
               AND json_extract(r.fields, '$.mergedCommitSha') IS NOT NULL
          )`,
      featureId,
    );
    return row ? numberValue(row.n) === 0 : false;
  }

  pageRouteCount(featureId: string): number {
    const row = this.one(
      "SELECT COUNT(*) AS n FROM names WHERE feature = ? AND kind = 'page_route'",
      featureId,
    );
    return row ? numberValue(row.n) : 0;
  }

  openChangeRequests(featureId: string): number {
    const row = this.one(
      `SELECT COUNT(*) AS n FROM nodes
        WHERE kind = 'ccr' AND status = 'active' AND feature = ?`,
      featureId,
    );
    return row ? numberValue(row.n) : 0;
  }

  journeyCount(featureId: string): number {
    const row = this.one(
      "SELECT COUNT(*) AS n FROM nodes WHERE kind = 'journey' AND status = 'active' AND feature = ?",
      featureId,
    );
    return row ? numberValue(row.n) : 0;
  }

  resumeWaiting(taskId: string): void {
    this.run(
      `UPDATE task_runtime SET state = 'READY', updated_rev = ?
        WHERE task = ? AND state = 'WAITING_INPUT'`,
      this.bumpRev(),
      taskId,
    );
  }

  resumable(): { taskId: string; attemptId: string; epoch: number } | null {
    const row = this.one(
      `SELECT task, holder_attempt AS attempt, epoch
         FROM task_runtime
        WHERE state = 'CODING'
          AND holder_attempt IS NOT NULL
          AND submission_pending = 0
          AND NOT EXISTS (SELECT 1 FROM task_holds h WHERE h.task = task_runtime.task)
        ORDER BY task
        LIMIT 1`,
    );
    if (!row || row.attempt === null) return null;
    return { taskId: String(row.task), attemptId: String(row.attempt), epoch: numberValue(row.epoch) };
  }

  readyTaskById(taskId: string): SqlRow | null {
    return (
      this.one(
        `SELECT t.task AS task, t.feature AS feature, t.level AS level,
                n.version AS version, n.content_hash AS content_hash, n.title AS title, n.text AS text,
                n.fields AS fields, f.wave AS wave, f.branch AS branch
           FROM task_runtime t
           JOIN nodes n ON n.id = t.task
           JOIN feature_runtime f ON f.feature = t.feature
          WHERE t.task = ?`,
        taskId,
      ) ?? null
    );
  }

  private passRequirements(taskId: string): void {
    const feature = this.one("SELECT feature FROM task_runtime WHERE task = ?", taskId);
    const featureId = feature ? String(feature.feature) : "";
    const requirements = this.all(
      `SELECT dst AS id FROM edges
        WHERE src = ? AND type = 'implements' AND valid_to_rev IS NULL`,
      taskId,
    );
    for (const requirement of requirements) {
      this.run(
        `INSERT INTO requirement_status(requirement, feature, status, updated_rev)
         VALUES (?, ?, 'passing', ?)
         ON CONFLICT(requirement) DO UPDATE SET status = 'passing', updated_rev = excluded.updated_rev`,
        String(requirement.id),
        featureId,
        this.bumpRev(),
      );
    }
  }

  private changeSet(summary: string): number {
    const rev = this.bumpRev();
    this.run(
      `INSERT INTO change_sets(id, rev, origin, author, created_at, summary)
       VALUES (?, ?, 'planner', 'sequential-runner', ?, ?)`,
      `CS-${rev}`,
      rev,
      rev,
      summary,
    );
    return rev;
  }

  private insertNode(input: {
    id: string;
    kind: string;
    title: string;
    text: string;
    fields: unknown;
    rev: number;
  }): void {
    const fields = JSON.stringify(input.fields);
    const hash = computeNodeContentHash({
      kind: input.kind,
      title: input.title,
      text: input.text,
      fields: input.fields,
    });
    this.run(
      `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
      input.id,
      input.kind,
      hash,
      input.title,
      input.text,
      fields,
      `CS-${input.rev}`,
      input.rev,
      input.rev,
    );
  }

  private insertEdge(src: string, type: string, dst: string, rev: number): void {
    this.run(
      `INSERT INTO edges(src, type, dst, change_set, valid_from_rev) VALUES (?, ?, ?, ?, ?)`,
      src,
      type,
      dst,
      `CS-${rev}`,
      rev,
    );
  }

  private run(sql: string, ...params: SqlValue[]): { changes: number } {
    return this.writer.run(sql, params);
  }

  private one(sql: string, ...params: SqlValue[]): SqlRow | null {
    const row = this.writer.get(sql, params);
    if (!isRow(row)) return null;
    return row;
  }

  private all(sql: string, ...params: SqlValue[]): SqlRow[] {
    return this.writer.all(sql, params).flatMap((row: unknown) => (isRow(row) ? [row] : []));
  }
}

function positional(args: readonly unknown[]): SqlValue[] | Record<string, SqlValue> | undefined {
  if (args.length === 0) return undefined;
  const first = args[0];
  if (args.length === 1 && isRow(first)) return first;
  return args as SqlValue[];
}

function isRow(value: unknown): value is SqlRow {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function changed(result: { changes: number | bigint }): number {
  return Number(result.changes);
}

function numberValue(value: SqlValue | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return 0;
}

function parseFields(raw: string): TaskFields {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as TaskFields;
}

function receiptFromFields(raw: string): AttemptReceipt {
  const value: unknown = JSON.parse(raw);
  const row = isRow(value) ? value : {};
  return {
    attemptId: String(row.attemptId ?? ""),
    taskId: String(row.task ?? ""),
    claimedAt: numberValue(row.claimedAt),
    briefTokens: numberValue(row.briefTokens),
    workerTurns: numberValue(row.workerTurns),
    costMicroUsd: numberValue(row.costMicroUsd),
    verifierVerdict: String(row.verifierVerdict ?? ""),
    mergedCommitSha: row.mergedCommitSha === null || row.mergedCommitSha === undefined ? null : String(row.mergedCommitSha),
    smokeMs: row.smokeMs === null || row.smokeMs === undefined ? null : numberValue(row.smokeMs),
    phase: String(row.phase ?? ""),
    hintStep: numberValue(row.hintStep),
    staticAudit: String(row.staticAudit ?? ""),
    detail: String(row.detail ?? ""),
  };
}
