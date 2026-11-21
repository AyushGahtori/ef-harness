import { DatabaseSync } from "node:sqlite";

import { MasterPlanError } from "./errors.js";
import { bigintToSqlite, sqliteToBigint } from "./integer-budget.js";
import type { BudgetLedgerPort, BudgetScopeWrite } from "./ports.js";
import { validateMasterPlan } from "./sanity-validator.js";
import { ENVELOPE_IDS, type MasterPlan } from "./types.js";

const MIGRATION = `
CREATE TABLE IF NOT EXISTS master_plans (
  plan_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  currency TEXT NOT NULL,
  total_units INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  committed INTEGER NOT NULL CHECK (committed IN (0, 1))
) STRICT;
CREATE INDEX IF NOT EXISTS master_plans_project ON master_plans(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS waves (
  plan_id TEXT NOT NULL,
  wave_key TEXT NOT NULL,
  wave_index INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('phase0', 'feature', 'completion')),
  status TEXT NOT NULL CHECK (status IN ('planned', 'projected')),
  task_count_min INTEGER,
  task_count_max INTEGER,
  cost_min_units INTEGER,
  cost_max_units INTEGER,
  currency TEXT NOT NULL,
  leaf_tasks_json TEXT CHECK (leaf_tasks_json IS NULL),
  feature_ids_json TEXT NOT NULL,
  depends_on_json TEXT NOT NULL,
  PRIMARY KEY (plan_id, wave_key)
) STRICT;

CREATE TABLE IF NOT EXISTS phase0_tasks (
  plan_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('serial', 'parallel')),
  depends_on_json TEXT NOT NULL,
  write_scope_json TEXT NOT NULL,
  level TEXT NOT NULL,
  title TEXT NOT NULL,
  steps_json TEXT NOT NULL,
  PRIMARY KEY (plan_id, task_id)
) STRICT;

CREATE TABLE IF NOT EXISTS feature_wave_assignments (
  plan_id TEXT NOT NULL,
  feature_id TEXT NOT NULL,
  wave_index INTEGER NOT NULL CHECK (wave_index >= 1),
  PRIMARY KEY (plan_id, feature_id)
) STRICT;

CREATE TABLE IF NOT EXISTS budget_envelopes (
  plan_id TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  envelope TEXT NOT NULL CHECK (
    envelope IN ('research', 'architecture', 'planning', 'integration_review', 'final_audit', 'build')
  ),
  currency TEXT NOT NULL,
  limit_units INTEGER NOT NULL CHECK (limit_units >= 0),
  spent_units INTEGER NOT NULL DEFAULT 0 CHECK (spent_units >= 0),
  weight INTEGER NOT NULL CHECK (weight >= 1),
  PRIMARY KEY (plan_id, scope_key, envelope)
) STRICT;

CREATE TABLE IF NOT EXISTS budgets (
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('project', 'feature', 'task', 'wave_paperwork', 'grant')),
  scope_id TEXT NOT NULL,
  currency TEXT NOT NULL,
  limit_units INTEGER NOT NULL CHECK (limit_units >= 0),
  reserved_units INTEGER NOT NULL DEFAULT 0 CHECK (reserved_units >= 0),
  spent_units INTEGER NOT NULL DEFAULT 0 CHECK (spent_units >= 0),
  closed INTEGER NOT NULL DEFAULT 0 CHECK (closed IN (0, 1)),
  parent_kind TEXT,
  parent_id TEXT,
  PRIMARY KEY (scope_kind, scope_id, currency)
) STRICT;
`;

export interface CheckpointSummary {
  readonly waves: number;
  readonly phase0Tasks: number;
  readonly assignments: number;
  readonly envelopes: number;
  readonly budgetScopes: number;
  readonly storedLeafTasks: number;
}

export interface CommitOptions {
  readonly onPhase?: (phase: string) => void;
  readonly ledger?: BudgetLedgerPort;
}

function encode(value: unknown): unknown {
  if (typeof value === "bigint") return { $u: value.toString() };
  if (Array.isArray(value)) return value.map((item) => encode(item));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = encode(item);
    return out;
  }
  return value;
}

function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => decode(item));
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length === 1 && typeof record.$u === "string" && /^\d+$/.test(record.$u)) {
      return BigInt(record.$u);
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(record)) out[key] = decode(item);
    return out;
  }
  return value;
}

export function serializeMasterPlan(plan: MasterPlan): string {
  return JSON.stringify(encode(plan));
}

export function deserializeMasterPlan(payload: string): MasterPlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload) as unknown;
  } catch {
    throw new MasterPlanError("corrupt_plan", "Master plan payload is not JSON");
  }
  const plan = decode(parsed) as MasterPlan;
  validateMasterPlan(plan);
  return plan;
}

export function ledgerRows(plan: MasterPlan): BudgetScopeWrite[] {
  const parentId = `${plan.planId}:${plan.projectId}`;
  const rows: BudgetScopeWrite[] = [
    {
      scopeKind: "project",
      scopeId: parentId,
      currency: plan.currencyCode,
      limitUnits: plan.totalUnits,
      parentKind: null,
      parentId: null,
    },
  ];
  for (const bucket of plan.allocation.buckets) {
    for (const envelope of ENVELOPE_IDS) {
      rows.push({
        scopeKind: envelope === "build" ? "project" : "wave_paperwork",
        scopeId: `${plan.planId}:${bucket.key}:${envelope}`,
        currency: plan.currencyCode,
        limitUnits: bucket.envelopes[envelope],
        parentKind: "project",
        parentId,
      });
    }
  }
  return rows;
}

function count(db: DatabaseSync, sql: string, planId: string): number {
  const row = db.prepare(sql).get(planId) as { n: number } | undefined;
  return row?.n ?? 0;
}

/**
 * Atomic checkpoint store for waves, phase0_tasks, feature_wave_assignments,
 * and budget_envelopes. A failed commit leaves the previous checkpoint intact.
 */
export class MasterPlanStore {
  private constructor(
    private readonly db: DatabaseSync,
    readonly path: string,
  ) {}

  static open(path: string): MasterPlanStore {
    const db = new DatabaseSync(path);
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(MIGRATION);
    return new MasterPlanStore(db, path);
  }

  close(): void {
    this.db.close();
  }

  commit(plan: MasterPlan, options: CommitOptions = {}): void {
    validateMasterPlan(plan);
    const payload = serializeMasterPlan(plan);
    const phase = (name: string): void => {
      options.onPhase?.(name);
    };
    this.db.exec("BEGIN IMMEDIATE");
    try {
      phase("master_plans");
      this.db
        .prepare(
          `INSERT INTO master_plans(plan_id, project_id, created_at, currency, total_units, payload_json, committed)
           VALUES (?, ?, ?, ?, ?, ?, 1)`,
        )
        .run(
          plan.planId,
          plan.projectId,
          plan.createdAt,
          plan.currencyCode,
          bigintToSqlite(plan.totalUnits),
          payload,
        );
      phase("waves");
      const insertWave = this.db.prepare(
        `INSERT INTO waves(
           plan_id, wave_key, wave_index, kind, status, task_count_min, task_count_max,
           cost_min_units, cost_max_units, currency, leaf_tasks_json, feature_ids_json, depends_on_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      );
      insertWave.run(
        plan.planId,
        "phase0",
        0,
        "phase0",
        "planned",
        plan.phase0.length,
        plan.phase0.length,
        null,
        null,
        plan.currencyCode,
        "[]",
        JSON.stringify([]),
      );
      for (const wave of plan.waves) {
        insertWave.run(
          plan.planId,
          `wave:${wave.index}`,
          wave.index,
          "feature",
          wave.status,
          wave.projected ? wave.projected.taskCount.min : null,
          wave.projected ? wave.projected.taskCount.max : null,
          wave.projected ? bigintToSqlite(wave.projected.costUnits.min) : null,
          wave.projected ? bigintToSqlite(wave.projected.costUnits.max) : null,
          plan.currencyCode,
          JSON.stringify(wave.featureIds),
          JSON.stringify(wave.dependsOn),
        );
      }
      insertWave.run(
        plan.planId,
        "completion",
        plan.completionWave.index,
        "completion",
        "projected",
        1,
        1,
        bigintToSqlite(plan.completionWave.projected.costUnits.min),
        bigintToSqlite(plan.completionWave.projected.costUnits.max),
        plan.currencyCode,
        "[]",
        JSON.stringify(plan.completionWave.dependsOn),
      );
      phase("phase0_tasks");
      const insertPhase0 = this.db.prepare(
        `INSERT INTO phase0_tasks(plan_id, task_id, stage, depends_on_json, write_scope_json, level, title, steps_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const recipe of plan.phase0) {
        insertPhase0.run(
          plan.planId,
          recipe.id,
          recipe.stage,
          JSON.stringify(recipe.dependsOn),
          JSON.stringify(recipe.writeScope),
          recipe.level,
          recipe.title,
          JSON.stringify(recipe.steps),
        );
      }
      phase("feature_wave_assignments");
      const insertAssignment = this.db.prepare(
        `INSERT INTO feature_wave_assignments(plan_id, feature_id, wave_index) VALUES (?, ?, ?)`,
      );
      for (const wave of plan.waves) {
        for (const featureId of wave.featureIds) insertAssignment.run(plan.planId, featureId, wave.index);
      }
      phase("budget_envelopes");
      const insertEnvelope = this.db.prepare(
        `INSERT INTO budget_envelopes(plan_id, scope_key, envelope, currency, limit_units, spent_units, weight)
         VALUES (?, ?, ?, ?, ?, 0, ?)`,
      );
      for (const bucket of plan.allocation.buckets) {
        for (const envelope of ENVELOPE_IDS) {
          insertEnvelope.run(
            plan.planId,
            bucket.key,
            envelope,
            plan.currencyCode,
            bigintToSqlite(bucket.envelopes[envelope]),
            bigintToSqlite(bucket.weight),
          );
        }
      }
      phase("budgets");
      const rows = ledgerRows(plan);
      if (options.ledger) {
        for (const row of rows) options.ledger.createBudgetScope(row);
      } else {
        const insertBudget = this.db.prepare(
          `INSERT INTO budgets(
             scope_kind, scope_id, currency, limit_units, reserved_units, spent_units, closed, parent_kind, parent_id
           ) VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?)`,
        );
        for (const row of rows) {
          insertBudget.run(
            row.scopeKind,
            row.scopeId,
            row.currency,
            bigintToSqlite(row.limitUnits),
            row.parentKind,
            row.parentId,
          );
        }
      }
      this.db.exec("COMMIT");
    } catch (error) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK");
      throw error;
    }
  }

  loadLatest(projectId: string): MasterPlan | null {
    const row = this.db
      .prepare(
        `SELECT payload_json FROM master_plans
         WHERE project_id = ? AND committed = 1
         ORDER BY created_at DESC, plan_id DESC
         LIMIT 1`,
      )
      .get(projectId) as { payload_json: string } | undefined;
    if (!row) return null;
    return deserializeMasterPlan(row.payload_json);
  }

  summary(planId: string): CheckpointSummary {
    const leafRow = this.db
      .prepare(`SELECT COUNT(*) AS n FROM waves WHERE plan_id = ? AND leaf_tasks_json IS NOT NULL`)
      .get(planId) as { n: number } | undefined;
    return {
      waves: count(this.db, `SELECT COUNT(*) AS n FROM waves WHERE plan_id = ?`, planId),
      phase0Tasks: count(this.db, `SELECT COUNT(*) AS n FROM phase0_tasks WHERE plan_id = ?`, planId),
      assignments: count(this.db, `SELECT COUNT(*) AS n FROM feature_wave_assignments WHERE plan_id = ?`, planId),
      envelopes: count(this.db, `SELECT COUNT(*) AS n FROM budget_envelopes WHERE plan_id = ?`, planId),
      budgetScopes: count(
        this.db,
        `SELECT COUNT(*) AS n FROM budgets WHERE scope_id LIKE ?`,
        `${planId}:%`,
      ),
      storedLeafTasks: leafRow?.n ?? 0,
    };
  }

  envelopeTotals(planId: string): Record<string, bigint> {
    const rows = this.db
      .prepare(
        `SELECT envelope, SUM(limit_units) AS units
         FROM budget_envelopes WHERE plan_id = ? GROUP BY envelope`,
      )
      .all(planId) as Array<{ envelope: string; units: number | bigint | string }>;
    const totals: Record<string, bigint> = {};
    for (const row of rows) totals[row.envelope] = sqliteToBigint(row.units, row.envelope);
    return totals;
  }
}
