import type { DatabaseSync } from "node:sqlite";

import { HumanStepError } from "./errors.js";
import { SqliteTaskHoldPort, nextCounter, withImmediateTransaction } from "./local-ports.js";
import { assertStepType, parseProbeResult, parseProbeSpec } from "./parse.js";
import { defaultHardLocal, isHumanStepStatus } from "./policy.js";
import type { TaskHoldPort } from "./ports.js";
import {
  FEATURE_SKIPPED_RESOLUTION,
  WAITING_ON_HUMAN_STEP_REASON,
  type CreateHumanStepInput,
  type HumanStepRecord,
  type HumanStepStatus,
  type ProbeResult,
  type TaskHoldRow,
} from "./types.js";

interface StepRow {
  step_id: string;
  step_type: string;
  title: string;
  instructions_json: string;
  probe_spec_json: string;
  status: string;
  last_probe_json: string | null;
  attested_at: number | null;
  verified_at: number | null;
  attestation_note: string | null;
  blocking_tasks_json: string;
  question_id: string | null;
  hard_local: number;
  resolution: string | null;
  graph_node_id: string | null;
}

/**
 * `state.db.human_steps` plus the `waiting_on_human_step` rows in `task_holds`.
 * Status changes and hold release share one `BEGIN IMMEDIATE` transaction.
 */
export class HumanStepStateStore {
  readonly holds: TaskHoldPort;

  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => number,
  ) {
    this.holds = new SqliteTaskHoldPort(db);
  }

  transaction<T>(body: () => T): T {
    return withImmediateTransaction(this.db, body);
  }

  create(
    input: CreateHumanStepInput & { readonly graphNodeId?: string },
    onInserted?: (step: HumanStepRecord) => void,
  ): HumanStepRecord {
    const hardLocal = input.hardLocal ?? defaultHardLocal(input.probeSpec);
    const createdAt = this.now();
    return this.transaction(() => {
      const stepId = input.stepId ?? `HS-${nextCounter(this.db, "step")}`;
      assertCreate({ ...input, stepId });
      this.db
        .prepare(
          `INSERT INTO human_steps(
             step_id, step_type, title, instructions_json, probe_spec_json, status, last_probe_json,
             attested_at, verified_at, attestation_note, blocking_tasks_json, question_id, hard_local,
             resolution, graph_node_id, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, NULL, ?, NULL, ?, NULL, ?, ?, ?)`,
        )
        .run(
          stepId,
          input.stepType,
          input.title,
          JSON.stringify(input.plainEnglishInstructions),
          JSON.stringify(input.probeSpec),
          JSON.stringify(input.blockingTaskIds),
          hardLocal ? 1 : 0,
          input.graphNodeId ?? null,
          createdAt,
          createdAt,
        );
      for (const task of input.blockingTaskIds) {
        this.holds.placeHold({
          task,
          reason: WAITING_ON_HUMAN_STEP_REASON,
          source: stepId,
          createdAt,
        });
      }
      const inserted = this.require(stepId);
      onInserted?.(inserted);
      return this.require(stepId);
    });
  }

  get(stepId: string): HumanStepRecord | null {
    const row = this.db.prepare(`SELECT * FROM human_steps WHERE step_id = ?`).get(stepId) as unknown as StepRow | undefined;
    return row ? mapRow(row) : null;
  }

  require(stepId: string): HumanStepRecord {
    const step = this.get(stepId);
    if (!step) throw new HumanStepError("step_missing", `No human step ${stepId}`);
    return step;
  }

  list(statuses?: readonly HumanStepStatus[]): readonly HumanStepRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM human_steps ORDER BY created_at, step_id`)
      .all() as unknown as StepRow[];
    const mapped = rows.map(mapRow);
    if (!statuses) return mapped;
    const allowed = new Set(statuses);
    return mapped.filter((step) => allowed.has(step.status));
  }

  /** Pending and failed steps that the cold-open hook should probe again. */
  listOutstanding(): readonly HumanStepRecord[] {
    return this.list(["pending", "failed"]).filter((step) => step.resolution !== FEATURE_SKIPPED_RESOLUTION);
  }

  setGraphNode(stepId: string, graphNodeId: string): void {
    this.touch(stepId, `UPDATE human_steps SET graph_node_id = ?, updated_at = ? WHERE step_id = ?`, [
      graphNodeId,
      this.now(),
      stepId,
    ]);
  }

  setQuestionId(stepId: string, questionId: string): void {
    this.touch(stepId, `UPDATE human_steps SET question_id = ?, updated_at = ? WHERE step_id = ?`, [
      questionId,
      this.now(),
      stepId,
    ]);
  }

  markProbing(stepId: string): HumanStepRecord {
    return this.transaction(() => {
      this.touch(stepId, `UPDATE human_steps SET status = 'probing', updated_at = ? WHERE step_id = ?`, [
        this.now(),
        stepId,
      ]);
      return this.require(stepId);
    });
  }

  restoreStatus(stepId: string, status: HumanStepStatus): HumanStepRecord {
    if (!isHumanStepStatus(status)) {
      throw new HumanStepError("status", "restoreStatus needs a known status");
    }
    return this.transaction(() => {
      this.touch(stepId, `UPDATE human_steps SET status = ?, updated_at = ? WHERE step_id = ?`, [
        status,
        this.now(),
        stepId,
      ]);
      return this.require(stepId);
    });
  }

  /**
   * Passing probes stamp `verified` and clear holds. Anything else stamps
   * `failed` and keeps or restores the holds. `onPass` runs inside the
   * transaction so a graph write failure rolls the stamp back.
   */
  commitProbeResult(stepId: string, result: ProbeResult, onPass?: () => void): HumanStepRecord {
    const scrubbed = scrubResult(result);
    return this.transaction(() => {
      const current = this.require(stepId);
      const passed = scrubbed.outcome === "pass";
      this.db
        .prepare(
          `UPDATE human_steps
             SET status = ?, last_probe_json = ?, verified_at = ?, attested_at = NULL, attestation_note = NULL,
                 resolution = NULL, updated_at = ?
           WHERE step_id = ?`,
        )
        .run(
          passed ? "verified" : "failed",
          JSON.stringify(scrubbed),
          passed ? scrubbed.checkedAt : null,
          this.now(),
          stepId,
        );
      if (passed) {
        this.releaseStepHolds(current);
        onPass?.();
      } else {
        this.ensureStepHolds(current);
      }
      const saved = this.require(stepId);
      if (saved.status === "verified" && saved.lastProbeResult?.outcome !== "pass") {
        throw new HumanStepError("honest_verified", "verified requires a passing probe");
      }
      return saved;
    });
  }

  commitAttestation(stepId: string, note: string, onAttest?: () => void): HumanStepRecord {
    const trimmed = note.trim();
    if (trimmed.length === 0) throw new HumanStepError("attestation_note", "An attestation needs a note");
    return this.transaction(() => {
      const current = this.require(stepId);
      if (current.status === "verified" && current.lastProbeResult?.outcome === "pass") {
        throw new HumanStepError("already_verified", "A passing probe cannot be replaced by attestation");
      }
      if (current.hardLocal) {
        throw new HumanStepError("hard_local", "A hard local requirement cannot be attested");
      }
      const attestedAt = this.now();
      this.db
        .prepare(
          `UPDATE human_steps
             SET status = 'attested', attested_at = ?, verified_at = NULL, attestation_note = ?, resolution = NULL, updated_at = ?
           WHERE step_id = ?`,
        )
        .run(attestedAt, trimmed, attestedAt, stepId);
      this.releaseStepHolds(current);
      onAttest?.();
      const saved = this.require(stepId);
      if (saved.status !== "attested" || saved.verifiedAt !== undefined) {
        throw new HumanStepError("honest_attested", "Manual confirmation must stay attested");
      }
      return saved;
    });
  }

  commitFeatureSkip(stepId: string): HumanStepRecord {
    return this.transaction(() => {
      const current = this.require(stepId);
      this.db
        .prepare(
          `UPDATE human_steps
             SET resolution = ?, verified_at = NULL, attested_at = NULL, status = 'pending', updated_at = ?
           WHERE step_id = ?`,
        )
        .run(FEATURE_SKIPPED_RESOLUTION, this.now(), stepId);
      this.releaseStepHolds(current);
      const saved = this.require(stepId);
      if (saved.status === "verified" || saved.status === "attested") {
        throw new HumanStepError("feature_skip", "Skipping a feature must not look verified or attested");
      }
      return saved;
    });
  }

  holdsFor(task: string): readonly TaskHoldRow[] {
    return this.holds.listHolds(task);
  }

  private releaseStepHolds(step: HumanStepRecord): void {
    for (const task of step.blockingTaskIds) {
      this.holds.releaseHold({ task, reason: WAITING_ON_HUMAN_STEP_REASON, source: step.stepId });
    }
  }

  private ensureStepHolds(step: HumanStepRecord): void {
    const createdAt = this.now();
    for (const task of step.blockingTaskIds) {
      this.holds.placeHold({
        task,
        reason: WAITING_ON_HUMAN_STEP_REASON,
        source: step.stepId,
        createdAt,
      });
    }
  }

  private touch(stepId: string, sql: string, params: readonly (string | number | null)[]): void {
    const result = this.db.prepare(sql).run(...params);
    if (result.changes === 0) throw new HumanStepError("step_missing", `No human step ${stepId}`);
  }
}

function assertCreate(input: CreateHumanStepInput & { readonly stepId: string }): void {
  assertStepType(input.stepType);
  if (!/^[A-Za-z][A-Za-z0-9._:-]{0,80}$/.test(input.stepId)) {
    throw new HumanStepError("step_id", "stepId must be a short token");
  }
  if (input.title.trim().length === 0) throw new HumanStepError("title", "title is required");
  if (input.plainEnglishInstructions.length === 0 || input.plainEnglishInstructions.some((line) => line.trim().length === 0)) {
    throw new HumanStepError("instructions", "plainEnglishInstructions needs at least one line");
  }
  if (input.blockingTaskIds.length === 0 || new Set(input.blockingTaskIds).size !== input.blockingTaskIds.length) {
    throw new HumanStepError("blocking_tasks", "blockingTaskIds needs unique task ids");
  }
  parseProbeSpec(input.probeSpec);
}

function mapRow(row: StepRow): HumanStepRecord {
  if (!isHumanStepStatus(row.status)) throw new HumanStepError("status", `Bad status ${row.status}`);
  assertStepType(row.step_type);
  const instructions = JSON.parse(row.instructions_json) as unknown;
  const blocking = JSON.parse(row.blocking_tasks_json) as unknown;
  if (!Array.isArray(instructions) || !instructions.every((line) => typeof line === "string")) {
    throw new HumanStepError("instructions", "Stored instructions are corrupt");
  }
  if (!Array.isArray(blocking) || !blocking.every((task) => typeof task === "string")) {
    throw new HumanStepError("blocking_tasks", "Stored blocking tasks are corrupt");
  }
  const stepType = row.step_type;
  if (!isStepType(stepType)) throw new HumanStepError("step_type", "Stored step type is corrupt");
  return {
    stepId: row.step_id,
    stepType,
    title: row.title,
    plainEnglishInstructions: instructions,
    probeSpec: parseProbeSpec(JSON.parse(row.probe_spec_json) as unknown),
    status: row.status,
    lastProbeResult: row.last_probe_json === null ? null : parseProbeResult(JSON.parse(row.last_probe_json) as unknown),
    blockingTaskIds: blocking,
    hardLocal: row.hard_local === 1,
    ...(row.attested_at === null ? {} : { attestedAt: row.attested_at }),
    ...(row.verified_at === null ? {} : { verifiedAt: row.verified_at }),
    ...(row.attestation_note === null ? {} : { attestationNote: row.attestation_note }),
    ...(row.resolution === FEATURE_SKIPPED_RESOLUTION ? { resolution: FEATURE_SKIPPED_RESOLUTION } : {}),
    ...(row.question_id === null ? {} : { questionId: row.question_id }),
    ...(row.graph_node_id === null ? {} : { graphNodeId: row.graph_node_id }),
  };
}

function isStepType(value: string): value is HumanStepRecord["stepType"] {
  return value === "runtime_install" ||
    value === "cli_auth" ||
    value === "webhook" ||
    value === "dns_record" ||
    value === "database" ||
    value === "email_domain" ||
    value === "cloud_api" ||
    value === "account_attestation";
}

function scrubResult(result: ProbeResult): ProbeResult {
  return {
    ...result,
    diagnosis: result.diagnosis.replace(/\s+/g, " ").trim(),
    evidence: { ...result.evidence, readOnly: true },
  };
}
