import { MasterPlanError } from "./errors.js";
import type { CurrencyKind } from "./types.js";

export interface MasterPlannerWaveDocument {
  readonly index: number;
  readonly features: readonly string[];
  readonly depends_on: readonly string[];
  readonly status: "planned" | "projected";
  readonly task_count: { readonly min: number; readonly max: number } | null;
  readonly cost_units: { readonly min: string; readonly max: string } | null;
}

export interface MasterPlannerV1Document {
  readonly schema: "master-planner@1";
  readonly phase0: readonly {
    readonly id: string;
    readonly stage: "serial" | "parallel";
    readonly depends_on: readonly string[];
    readonly write_scope: readonly string[];
  }[];
  readonly waves: readonly MasterPlannerWaveDocument[];
  readonly completion_wave: {
    readonly id: "completion";
    readonly owner_task: "101";
    readonly index: number;
    readonly depends_on: readonly string[];
    readonly status: "projected";
  };
  readonly estimates: {
    readonly planned_wave_indexes: readonly number[];
    readonly projected: readonly {
      readonly wave_index: number;
      readonly task_count: { readonly min: number; readonly max: number };
      readonly cost_units: { readonly min: string; readonly max: string };
    }[];
  };
  readonly paperwork_projection: {
    readonly currency: CurrencyKind;
    readonly total_units: string;
    readonly research_units: string;
    readonly architecture_units: string;
    readonly planning_units: string;
    readonly integration_review_units: string;
    readonly final_audit_units: string;
    readonly build_units: string;
    readonly paperwork_units: string;
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function leafList(record: Record<string, unknown>): unknown[] | null {
  const raw = record.leaf_tasks ?? record.leafTasks ?? record.tasks;
  return Array.isArray(raw) ? raw : null;
}

/**
 * Hard-reject concrete leaf tasks on Wave 2+ and on any projected wave.
 * Wave 1 leaves belong to feature-planner@1, not this schema's stored plan.
 */
export function assertNoPrematureLeafPayload(input: unknown): void {
  const record = asRecord(input);
  if (!record) return;
  const waves = Array.isArray(record.waves) ? record.waves : [];
  const completion = record.completion_wave ?? record.completionWave;
  const candidates = completion ? [...waves, completion] : waves;
  for (const candidate of candidates) {
    const wave = asRecord(candidate);
    if (!wave) continue;
    const leaves = leafList(wave);
    if (!leaves || leaves.length === 0) continue;
    const index = typeof wave.index === "number" ? wave.index : null;
    const status = wave.status;
    const projected = status === "projected" || (index !== null && index >= 2) || wave.id === "completion";
    if (projected) {
      throw new MasterPlanError(
        "premature_wave_leaf_tasks",
        `Wave ${index ?? "projected"} cannot store ${leaves.length} leaf tasks; Waves 2+ keep feature assignments and projected ranges only`,
      );
    }
  }
}

export function assertNoProposedLeaves(
  proposed: Readonly<Record<string, readonly { readonly id: string }[]>> | undefined,
): void {
  if (!proposed) return;
  for (const [key, tasks] of Object.entries(proposed)) {
    const index = Number(key);
    if (Number.isInteger(index) && index >= 2 && tasks.length > 0) {
      throw new MasterPlanError(
        "premature_wave_leaf_tasks",
        `Wave ${index} cannot store ${tasks.length} leaf tasks; Waves 2+ keep feature assignments and projected ranges only`,
      );
    }
  }
}

function parseUnits(value: unknown, label: string): bigint {
  if (typeof value === "bigint" && value >= 0n) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  throw new MasterPlanError("invalid_model_output", `${label} must be a non-negative integer`);
}

function parsePositiveIndex(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new MasterPlanError("invalid_model_output", `${label} must be a positive integer`);
  }
  return value;
}

function parseCurrency(value: unknown): "usd" | "allowance_ppm" {
  if (value === "usd" || value === "allowance_ppm") return value;
  throw new MasterPlanError("invalid_model_output", "paperwork currency must be usd or allowance_ppm");
}

function parseStage(value: unknown, label: string): "serial" | "parallel" {
  if (value === "serial" || value === "parallel") return value;
  throw new MasterPlanError("invalid_model_output", `${label} has an invalid stage`);
}

function parseWaveStatus(value: unknown, label: string): "planned" | "projected" {
  if (value === "planned" || value === "projected") return value;
  throw new MasterPlanError("invalid_model_output", `${label} has an invalid status`);
}

function parseStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new MasterPlanError("invalid_model_output", `${label} must be an array of strings`);
  }
  return value;
}

function parseCount(value: unknown, label: string): { min: number; max: number } | null {
  if (value === null) return null;
  const record = asRecord(value);
  if (!record || typeof record.min !== "number" || typeof record.max !== "number") {
    throw new MasterPlanError("invalid_model_output", `${label} must be a min/max count`);
  }
  if (!Number.isInteger(record.min) || !Number.isInteger(record.max) || record.min < 0 || record.max < record.min) {
    throw new MasterPlanError("invalid_model_output", `${label} has an invalid count range`);
  }
  return { min: record.min, max: record.max };
}

function parseCost(value: unknown, label: string): { min: string; max: string } | null {
  if (value === null) return null;
  const record = asRecord(value);
  if (!record) throw new MasterPlanError("invalid_model_output", `${label} must be a cost range`);
  const min = parseUnits(record.min, `${label}.min`);
  const max = parseUnits(record.max, `${label}.max`);
  if (max < min) throw new MasterPlanError("invalid_model_output", `${label} is inverted`);
  return { min: min.toString(), max: max.toString() };
}

/**
 * Local port for Task 009 `MasterPlannerV1Schema`.
 * Closed enough to reject leaf-task smuggling and non-integer money.
 */
export function parseMasterPlannerV1(input: unknown): MasterPlannerV1Document {
  assertNoPrematureLeafPayload(input);
  const record = asRecord(input);
  if (!record) {
    throw new MasterPlanError("invalid_model_output", "master-planner@1 output must be an object");
  }
  if (record.schema !== "master-planner@1") {
    throw new MasterPlanError("invalid_model_output", "schema must be master-planner@1");
  }
  if (!Array.isArray(record.phase0)) {
    throw new MasterPlanError("invalid_model_output", "phase0 must be an array");
  }
  const phase0 = record.phase0.map((item, index) => {
    const recipe = asRecord(item);
    const rawId = recipe?.id;
    if (!recipe || typeof rawId !== "string" || rawId.length === 0) {
      throw new MasterPlanError("invalid_model_output", `phase0[${index}] is not a recipe`);
    }
    const id = rawId;
    const stage = parseStage(recipe.stage, id);
    return {
      id,
      stage,
      depends_on: parseStringArray(recipe.depends_on, `${id}.depends_on`),
      write_scope: parseStringArray(recipe.write_scope, `${id}.write_scope`),
    };
  });
  if (!Array.isArray(record.waves)) {
    throw new MasterPlanError("invalid_model_output", "waves must be an array");
  }
  const waves = record.waves.map((item, index) => {
    const wave = asRecord(item);
    if (!wave) {
      throw new MasterPlanError("invalid_model_output", `waves[${index}] has an invalid index`);
    }
    const waveIndex = parsePositiveIndex(wave.index, `waves[${index}] index`);
    const status = parseWaveStatus(wave.status, `wave ${waveIndex}`);
    if (waveIndex === 1 && status !== "planned") {
      throw new MasterPlanError("invalid_model_output", "Wave 1 must be planned, not projected");
    }
    if (waveIndex >= 2 && status !== "projected") {
      throw new MasterPlanError("invalid_model_output", `Wave ${waveIndex} must be projected`);
    }
    return {
      index: waveIndex,
      features: parseStringArray(wave.features, `wave ${waveIndex} features`),
      depends_on: parseStringArray(wave.depends_on, `wave ${waveIndex} depends_on`),
      status,
      task_count: parseCount(wave.task_count, `wave ${waveIndex} task_count`),
      cost_units: parseCost(wave.cost_units, `wave ${waveIndex} cost_units`),
    };
  });
  const completion = asRecord(record.completion_wave);
  if (!completion || completion.id !== "completion" || completion.owner_task !== "101") {
    throw new MasterPlanError("invalid_model_output", "completion_wave must be Task 101");
  }
  const completionIndex = parsePositiveIndex(completion.index, "completion_wave index");
  if (completion.status !== "projected") {
    throw new MasterPlanError("invalid_model_output", "completion_wave must be projected");
  }
  const estimates = asRecord(record.estimates);
  if (!estimates || !Array.isArray(estimates.projected) || !Array.isArray(estimates.planned_wave_indexes)) {
    throw new MasterPlanError("invalid_model_output", "estimates are missing");
  }
  const paperwork = asRecord(record.paperwork_projection);
  if (!paperwork) {
    throw new MasterPlanError("invalid_model_output", "paperwork_projection is missing");
  }
  const currency = parseCurrency(paperwork.currency);
  const research = parseUnits(paperwork.research_units, "research_units");
  const architecture = parseUnits(paperwork.architecture_units, "architecture_units");
  const planning = parseUnits(paperwork.planning_units, "planning_units");
  const integration = parseUnits(paperwork.integration_review_units, "integration_review_units");
  const audit = parseUnits(paperwork.final_audit_units, "final_audit_units");
  const build = parseUnits(paperwork.build_units, "build_units");
  const paperworkUnits = parseUnits(paperwork.paperwork_units, "paperwork_units");
  const total = parseUnits(paperwork.total_units, "total_units");
  if (research + architecture + planning + integration + audit !== paperworkUnits) {
    throw new MasterPlanError("budget_drift", "Paperwork projection sub-envelopes do not sum");
  }
  if (paperworkUnits + build !== total) {
    throw new MasterPlanError("budget_drift", "Paperwork projection does not sum to the project total");
  }
  const projected = estimates.projected.map((item, index) => {
    const row = asRecord(item);
    if (!row) {
      throw new MasterPlanError("invalid_model_output", `estimates.projected[${index}] is invalid`);
    }
    const waveIndex = parsePositiveIndex(row.wave_index, `estimates.projected[${index}].wave_index`);
    const taskCount = parseCount(row.task_count, `estimates.projected[${index}].task_count`);
    const cost = parseCost(row.cost_units, `estimates.projected[${index}].cost_units`);
    if (!taskCount || !cost) {
      throw new MasterPlanError("invalid_model_output", `Wave ${waveIndex} projection is incomplete`);
    }
    return { wave_index: waveIndex, task_count: taskCount, cost_units: cost };
  });
  return {
    schema: "master-planner@1",
    phase0,
    waves,
    completion_wave: {
      id: "completion",
      owner_task: "101",
      index: completionIndex,
      depends_on: parseStringArray(completion.depends_on, "completion_wave.depends_on"),
      status: "projected",
    },
    estimates: {
      planned_wave_indexes: estimates.planned_wave_indexes.filter((item): item is number => typeof item === "number"),
      projected,
    },
    paperwork_projection: {
      currency,
      total_units: total.toString(),
      research_units: research.toString(),
      architecture_units: architecture.toString(),
      planning_units: planning.toString(),
      integration_review_units: integration.toString(),
      final_audit_units: audit.toString(),
      build_units: build.toString(),
      paperwork_units: paperworkUnits.toString(),
    },
  };
}
