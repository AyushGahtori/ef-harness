import path from "node:path";
import { bindKnowledgeGraph, type ProjectStateDb } from "@ef-harness/db";

import { openPlannerState } from "../state/project-db.js";
import { MasterPlanError } from "./errors.js";
import type { BudgetLedgerPort, BudgetScopeWrite } from "./ports.js";
import { validateMasterPlan } from "./sanity-validator.js";
import { ENVELOPE_IDS, type EnvelopeId, type MasterPlan } from "./types.js";

const PAPERWORK_PHASE: Partial<Record<EnvelopeId, "spec" | "research" | "architecture" | "planning" | "audit">> = {
  research: "research",
  architecture: "architecture",
  planning: "planning",
  integration_review: "spec",
  final_audit: "audit",
};

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

const COMMIT_PHASES = [
  "master_plans",
  "waves",
  "phase0_tasks",
  "feature_wave_assignments",
  "budget_envelopes",
  "budgets",
] as const;

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

/**
 * Project root owns the whole budget. Paperwork children are `wave_paperwork`
 * rows parented to that project. Build spend stays on the project scope, so a
 * child row is never `scope_kind = project`.
 */
export function ledgerRows(plan: MasterPlan): BudgetScopeWrite[] {
  const rows: BudgetScopeWrite[] = [
    {
      scopeKind: "project",
      scopeId: plan.projectId,
      currency: plan.currencyCode,
      limitUnits: plan.totalUnits,
      parentKind: null,
      parentId: null,
    },
  ];
  plan.allocation.buckets.forEach((bucket, index) => {
    const waveId = ledgerWaveId(bucket.key, index);
    for (const envelope of ENVELOPE_IDS) {
      const phase = PAPERWORK_PHASE[envelope];
      if (!phase) continue;
      rows.push({
        scopeKind: "wave_paperwork",
        scopeId: waveScopeId(index, waveId, phase),
        currency: plan.currencyCode,
        limitUnits: bucket.envelopes[envelope],
        parentKind: "project",
        parentId: plan.projectId,
      });
    }
  });
  return rows;
}

function ledgerWaveId(key: string, index: number): string {
  const cleaned = key.replace(/[^A-Za-z0-9._-]/g, "-");
  if (/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(cleaned)) return cleaned;
  return `wave${String(index)}`;
}

function waveScopeId(ordinal: number, waveId: string, phase: string): string {
  return `w:${String(ordinal).padStart(4, "0")}:${waveId}:${phase}`;
}

function units(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new MasterPlanError("invalid_budget", "Budget units must fit a non-negative safe integer");
  }
  return Number(value);
}

/**
 * Master-plan checkpoint on `ProjectStateDb`.
 * The plan document is a `plan` node. Features, phase-0 tasks, and `depends_on`
 * edges are real graph rows. Budget rows use `schema/state.sql` `budgets`.
 */
export class MasterPlanStore {
  private constructor(
    readonly state: ProjectStateDb,
    readonly path: string,
  ) {}

  static open(dbPath: string): MasterPlanStore {
    const rootDir = path.dirname(dbPath);
    return new MasterPlanStore(openPlannerState(rootDir), dbPath);
  }

  static fromState(state: ProjectStateDb): MasterPlanStore {
    return new MasterPlanStore(state, state.databasePath);
  }

  close(): void {
    this.state.close();
  }

  commit(plan: MasterPlan, options: CommitOptions = {}): void {
    validateMasterPlan(plan);
    for (const phase of COMMIT_PHASES) options.onPhase?.(phase);
    const payload = serializeMasterPlan(plan);
    const repo = bindKnowledgeGraph(this.state);
    const nodes = [
      {
        op: "create" as const,
        id: plan.planId,
        kind: "plan",
        title: plan.planId,
        text: payload,
        status: "active" as const,
        fields: {
          projectId: plan.projectId,
          createdAt: plan.createdAt,
          record: "master_plan",
          committed: true,
        },
      },
      ...plan.features.map((feature) => ({
        op: "create" as const,
        id: feature.id,
        kind: "feature",
        title: feature.title,
        text: feature.title,
        status: "active" as const,
        fields: { feature: feature.id, title: feature.title },
      })),
      ...plan.phase0.map((recipe) => ({
        op: "create" as const,
        id: recipe.id,
        kind: "task",
        title: recipe.title,
        text: recipe.title,
        status: "active" as const,
        fields: {
          feature: plan.walkingSkeletonFeatureId,
          level: recipe.level,
          stage: recipe.stage,
          write_scope: recipe.writeScope,
        },
      })),
    ];
    const edges = [
      ...plan.features.flatMap((feature) =>
        feature.dependsOn.map((dependency) => ({
          op: "create" as const,
          src: feature.id,
          type: "depends_on",
          dst: dependency,
        })),
      ),
      ...plan.phase0.flatMap((recipe) =>
        recipe.dependsOn.map((dependency) => ({
          op: "create" as const,
          src: recipe.id,
          type: "depends_on",
          dst: dependency,
        })),
      ),
    ];
    const committed = repo.commitChangeSet({
      origin: "planner",
      author: "master-planner@1",
      summary: `master plan ${plan.planId}`,
      nodes,
      edges,
    });
    this.writeRuntime(plan, committed.rev);
    this.writeBudgets(plan, options.ledger);
  }

  loadLatest(projectId: string): MasterPlan | null {
    const rows = this.state.writer.all(
      `SELECT id, text, fields FROM nodes
        WHERE kind = 'plan' AND status = 'active' AND json_extract(fields, '$.projectId') = ?
        ORDER BY json_extract(fields, '$.createdAt') DESC, id DESC`,
      [projectId],
    );
    for (const row of rows) {
      if (!isRecord(row) || typeof row.text !== "string") continue;
      return deserializeMasterPlan(row.text);
    }
    return null;
  }

  summary(planId: string): CheckpointSummary {
    const plan = this.loadById(planId);
    if (!plan) {
      return { waves: 0, phase0Tasks: 0, assignments: 0, envelopes: 0, budgetScopes: 0, storedLeafTasks: 0 };
    }
    return {
      waves: 2 + plan.waves.length,
      phase0Tasks: plan.phase0.length,
      assignments: plan.waves.reduce((count, wave) => count + wave.featureIds.length, 0),
      envelopes: plan.allocation.buckets.length * ENVELOPE_IDS.length,
      budgetScopes: this.budgetScopeCount(),
      storedLeafTasks: 0,
    };
  }

  envelopeTotals(planId: string): Record<string, bigint> {
    const plan = this.loadById(planId);
    if (!plan) return {};
    const totals: Record<string, bigint> = {};
    for (const id of ENVELOPE_IDS) totals[id] = plan.allocation.envelopes[id];
    return totals;
  }

  private loadById(planId: string): MasterPlan | null {
    const row = this.state.writer.get("SELECT text FROM nodes WHERE id = ? AND kind = 'plan' AND status = 'active'", [
      planId,
    ]);
    if (!isRecord(row) || typeof row.text !== "string") return null;
    return deserializeMasterPlan(row.text);
  }

  private budgetScopeCount(): number {
    const row = this.state.writer.get("SELECT COUNT(*) AS n FROM budgets");
    if (!isRecord(row)) return 0;
    return typeof row.n === "number" ? row.n : Number(row.n);
  }

  private writeRuntime(plan: MasterPlan, rev: number): void {
    const writer = this.state.writer;
    writer.transaction(() => {
      for (const feature of plan.features) {
        const wave = plan.waves.find((item) => item.featureIds.includes(feature.id));
        writer.run(
          `INSERT INTO feature_runtime(feature, state, wave, epoch, updated_rev)
           VALUES (?, 'PLANNED', ?, 0, ?)
           ON CONFLICT(feature) DO NOTHING`,
          [feature.id, wave ? wave.index : null, rev],
        );
      }
      for (const recipe of plan.phase0) {
        writer.run(
          `INSERT INTO task_runtime(task, feature, state, level, epoch, submission_pending, updated_rev)
           VALUES (?, ?, 'DRAFTED', ?, 0, 0, ?)
           ON CONFLICT(task) DO NOTHING`,
          [recipe.id, plan.walkingSkeletonFeatureId, recipe.level, rev],
        );
      }
    });
  }

  private writeBudgets(plan: MasterPlan, ledger: BudgetLedgerPort | undefined): void {
    const rows = ledgerRows(plan);
    if (ledger) {
      for (const row of rows) ledger.createBudgetScope(row);
      return;
    }
    const writer = this.state.writer;
    writer.transaction(() => {
      if (plan.currencyCode !== "usd") {
        writer.run(
          `INSERT INTO currencies(code, unit, scale) VALUES (?, 'ppm of window share', 1000000)
           ON CONFLICT(code) DO NOTHING`,
          [plan.currencyCode],
        );
      }
      for (const row of rows) {
        writer.run(
          `INSERT INTO budgets(
             scope_kind, scope_id, currency, limit_units, reserved_units, spent_units, closed, parent_kind, parent_id
           ) VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?)`,
          [row.scopeKind, row.scopeId, row.currency, units(row.limitUnits), row.parentKind, row.parentId],
        );
      }
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
