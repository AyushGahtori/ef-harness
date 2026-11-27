import { createHash } from "node:crypto";

import { MasterPlanError } from "./errors.js";
import { defaultCostPerLeaf } from "./integer-budget.js";
import { currencyCode, type MasterPlanRequest } from "./ports.js";
import { Phase0RecipeGenerator } from "./phase0-recipe-generator.js";
import { PaperworkBudgetEnvelopeAllocator } from "./paperwork-budget-envelope-allocator.js";
import { validateMasterPlan } from "./sanity-validator.js";
import { assertNoPrematureLeafPayload, assertNoProposedLeaves, parseMasterPlannerV1 } from "./schema.js";
import type { MasterPlannerV1Document } from "./schema.js";
import { MasterPlanStore } from "./state-db.js";
import type { FeatureInput, MasterPlan, PlannedFeature } from "./types.js";
import { allocationWeights, WaveDagBuilder } from "./wave-dag-builder.js";

export interface MasterPlanOrchestratorDeps {
  readonly recipes?: Phase0RecipeGenerator;
  readonly waves?: WaveDagBuilder;
  readonly budgets?: PaperworkBudgetEnvelopeAllocator;
  readonly clock?: () => number;
}

const FEATURE_ID = /^[A-Za-z][A-Za-z0-9._:-]{0,63}$/;

function count(value: number | undefined, label: string): number {
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || value < 0) {
    throw new MasterPlanError("invalid_feature_id", `${label} must be a non-negative integer`);
  }
  return value;
}

function normalizeFeature(raw: FeatureInput): PlannedFeature {
  const id = raw.id.trim();
  if (!FEATURE_ID.test(id)) {
    throw new MasterPlanError("invalid_feature_id", `Feature id ${raw.id} is not a stable token`);
  }
  const title = raw.title.trim();
  if (!title) throw new MasterPlanError("invalid_feature_id", `Feature ${id} needs a title`);
  const dependsOn: string[] = [];
  const seen = new Set<string>();
  for (const dep of raw.dependsOn) {
    if (seen.has(dep)) continue;
    seen.add(dep);
    dependsOn.push(dep);
  }
  const estimatedLeafTasks = raw.estimatedLeafTasks
    ? { min: raw.estimatedLeafTasks.min, max: raw.estimatedLeafTasks.max }
    : null;
  const estimatedCostUnits = raw.estimatedCostUnits
    ? { min: raw.estimatedCostUnits.min, max: raw.estimatedCostUnits.max }
    : null;
  return {
    id,
    title,
    dependsOn,
    active: true,
    verticalSlice: raw.verticalSlice === undefined ? null : raw.verticalSlice,
    specItems: count(raw.specItems, `${id} specItems`),
    screens: count(raw.screens, `${id} screens`),
    endpoints: count(raw.endpoints, `${id} endpoints`),
    estimatedLeafTasks,
    estimatedCostUnits,
  };
}

function designateSkeleton(features: readonly PlannedFeature[]): {
  readonly features: PlannedFeature[];
  readonly walkingSkeletonFeatureId: string;
  readonly walkingSkeletonSource: "explicit" | "implicit_first_root";
} {
  const byId = (left: PlannedFeature, right: PlannedFeature): number => (left.id < right.id ? -1 : 1);
  const explicit = features
    .filter((feature) => feature.verticalSlice === true && feature.dependsOn.length === 0)
    .sort(byId);
  const chosenExplicit = explicit[0];
  if (chosenExplicit) {
    return {
      features: features.map((feature) => ({ ...feature, dependsOn: [...feature.dependsOn] })),
      walkingSkeletonFeatureId: chosenExplicit.id,
      walkingSkeletonSource: "explicit",
    };
  }
  const implicit = features
    .filter((feature) => feature.verticalSlice === null && feature.dependsOn.length === 0)
    .sort(byId);
  const chosen = implicit[0];
  if (!chosen) {
    throw new MasterPlanError(
      "wave1_missing_vertical_slice",
      "Wave 1 must contain at least one immediately buildable vertical-slice feature",
    );
  }
  return {
    features: features.map((feature) =>
      feature.id === chosen.id
        ? { ...feature, verticalSlice: true, dependsOn: [...feature.dependsOn] }
        : { ...feature, dependsOn: [...feature.dependsOn] },
    ),
    walkingSkeletonFeatureId: chosen.id,
    walkingSkeletonSource: "implicit_first_root",
  };
}

function resolveBreadth(parallelism: MasterPlanRequest["parallelism"]): number {
  const values = [parallelism.hardwareSlots, parallelism.providerSlots];
  if (parallelism.developerMax !== undefined) values.push(parallelism.developerMax);
  for (const value of values) {
    if (!Number.isInteger(value) || value < 1) {
      throw new MasterPlanError("invalid_breadth", "Parallelism slots must be positive integers");
    }
  }
  return Math.min(...values);
}

function toMasterPlannerV1(plan: MasterPlan): MasterPlannerV1Document {
  return {
    schema: "master-planner@1",
    phase0: plan.phase0.map((recipe) => ({
      id: recipe.id,
      stage: recipe.stage,
      depends_on: [...recipe.dependsOn],
      write_scope: [...recipe.writeScope],
    })),
    waves: plan.waves.map((wave) => ({
      index: wave.index,
      features: [...wave.featureIds],
      depends_on: [...wave.dependsOn],
      status: wave.status,
      task_count: wave.projected ? { min: wave.projected.taskCount.min, max: wave.projected.taskCount.max } : null,
      cost_units: wave.projected
        ? { min: wave.projected.costUnits.min.toString(), max: wave.projected.costUnits.max.toString() }
        : null,
    })),
    completion_wave: {
      id: "completion",
      owner_task: "101",
      index: plan.completionWave.index,
      depends_on: [...plan.completionWave.dependsOn],
      status: "projected",
    },
    estimates: {
      planned_wave_indexes: plan.waves.filter((wave) => wave.status === "planned").map((wave) => wave.index),
      projected: plan.waves.flatMap((wave) => {
        if (!wave.projected) return [];
        return [
          {
            wave_index: wave.index,
            task_count: { min: wave.projected.taskCount.min, max: wave.projected.taskCount.max },
            cost_units: {
              min: wave.projected.costUnits.min.toString(),
              max: wave.projected.costUnits.max.toString(),
            },
          },
        ];
      }),
    },
    paperwork_projection: {
      currency: plan.currency,
      total_units: plan.totalUnits.toString(),
      research_units: plan.allocation.envelopes.research.toString(),
      architecture_units: plan.allocation.envelopes.architecture.toString(),
      planning_units: plan.allocation.envelopes.planning.toString(),
      integration_review_units: plan.allocation.envelopes.integration_review.toString(),
      final_audit_units: plan.allocation.envelopes.final_audit.toString(),
      build_units: plan.allocation.envelopes.build.toString(),
      paperwork_units: plan.allocation.paperworkUnits.toString(),
    },
  };
}

/**
 * master-planner@1. Builds Phase 0, ordered feature waves, the completion wave,
 * and the integer paperwork envelopes. Waves 2+ never receive leaf tasks.
 */
export class MasterPlanOrchestrator {
  private readonly recipes: Phase0RecipeGenerator;
  private readonly waves: WaveDagBuilder;
  private readonly budgets: PaperworkBudgetEnvelopeAllocator;
  private readonly clock: () => number;

  constructor(deps: MasterPlanOrchestratorDeps = {}) {
    this.recipes = deps.recipes ?? new Phase0RecipeGenerator();
    this.waves = deps.waves ?? new WaveDagBuilder();
    this.budgets = deps.budgets ?? new PaperworkBudgetEnvelopeAllocator();
    this.clock = deps.clock ?? (() => Date.now());
  }

  plan(request: MasterPlanRequest): MasterPlan {
    assertNoProposedLeaves(request.proposedLeafTasks);
    assertNoPrematureLeafPayload(request.modelOutput);
    const model = request.modelOutput;
    if (model && typeof model === "object" && !Array.isArray(model) && "schema" in model) {
      const schema = (model as { schema?: unknown }).schema;
      if (schema === "master-planner@1") parseMasterPlannerV1(model);
    }
    if (request.architecture.projectId !== request.projectId) {
      throw new MasterPlanError("project_mismatch", "Architecture project id does not match the request");
    }
    if (typeof request.budget.totalUnits !== "bigint" || request.budget.totalUnits < 0n) {
      throw new MasterPlanError("invalid_budget", "totalUnits must be a non-negative bigint");
    }
    const graphIds = new Set(request.graph?.listActiveFeatureIds(request.projectId) ?? []);
    const byId = new Map<string, FeatureInput>();
    for (const feature of request.features) {
      if (byId.has(feature.id)) {
        throw new MasterPlanError("duplicate_feature", `Duplicate feature ${feature.id}`);
      }
      byId.set(feature.id, feature);
    }
    for (const id of request.architecture.featureIds) {
      if (!byId.has(id)) {
        throw new MasterPlanError("unscheduled_feature", `Feature ${id} is unscheduled`);
      }
    }
    for (const id of graphIds) {
      if (!byId.has(id)) {
        throw new MasterPlanError("unscheduled_feature", `Feature ${id} is unscheduled`);
      }
    }
    const inactiveFeatureIds: string[] = [];
    const active: PlannedFeature[] = [];
    for (const feature of request.features) {
      const inArchitecture = request.architecture.featureIds.includes(feature.id);
      const forced = graphIds.has(feature.id);
      if (!inArchitecture && !forced) {
        if (feature.active === false) {
          inactiveFeatureIds.push(feature.id);
          continue;
        }
        throw new MasterPlanError(
          "feature_outside_architecture",
          `Feature ${feature.id} is outside the locked feature map`,
        );
      }
      active.push(normalizeFeature(feature));
    }
    const skeleton = designateSkeleton(active);
    const phase0 = this.recipes.generate({
      projectKind: request.architecture.projectKind,
      ...(request.architecture.database === undefined ? {} : { database: request.architecture.database }),
      ...(request.architecture.auth === undefined ? {} : { auth: request.architecture.auth }),
    });
    const costPerLeafUnits = request.budget.costPerLeafUnits ?? defaultCostPerLeaf(request.budget.currency);
    if (costPerLeafUnits < 0n) {
      throw new MasterPlanError("invalid_budget", "costPerLeafUnits must be non-negative");
    }
    const breadthCap = resolveBreadth(request.parallelism);
    const dag = this.waves.build(skeleton.features, { breadthCap, costPerLeafUnits });
    const createdAt = request.createdAt ?? this.clock();
    if (!Number.isSafeInteger(createdAt) || createdAt < 0) {
      throw new MasterPlanError("corrupt_plan", "createdAt must be a non-negative safe integer");
    }
    const connectionId = request.budget.connectionId?.trim() ? request.budget.connectionId.trim() : null;
    const allocation = this.budgets.allocate({
      currency: request.budget.currency,
      totalUnits: request.budget.totalUnits,
      weights: allocationWeights(phase0.recipes.length, dag.waves),
    });
    const planId = `mp_${createHash("sha256")
      .update(
        JSON.stringify({
          projectId: request.projectId,
          createdAt,
          currency: request.budget.currency,
          total: request.budget.totalUnits.toString(),
          phase0: phase0.recipes.map((recipe) => recipe.id),
          waves: dag.waves.map((wave) => wave.featureIds),
        }),
      )
      .digest("hex")
      .slice(0, 32)}`;
    const plan: MasterPlan = {
      schema: "master-planner@1",
      payloadVersion: 1,
      planId,
      projectId: request.projectId,
      projectKind: request.architecture.projectKind,
      createdAt,
      currency: request.budget.currency,
      currencyCode: currencyCode(request.budget.currency, connectionId),
      connectionId,
      totalUnits: request.budget.totalUnits,
      costPerLeafUnits,
      breadthCap,
      capabilities: phase0.capabilities,
      walkingSkeletonFeatureId: skeleton.walkingSkeletonFeatureId,
      walkingSkeletonSource: skeleton.walkingSkeletonSource,
      phase0: phase0.recipes,
      omittedPhase0: phase0.omitted,
      waves: dag.waves,
      completionWave: dag.completionWave,
      features: skeleton.features,
      inactiveFeatureIds,
      allocation,
    };
    parseMasterPlannerV1(toMasterPlannerV1(plan));
    validateMasterPlan(plan);
    return plan;
  }

  commit(store: MasterPlanStore, request: MasterPlanRequest): MasterPlan {
    const plan = this.plan(request);
    if (request.ledger) store.commit(plan, { ledger: request.ledger });
    else store.commit(plan);
    return plan;
  }

  resume(store: MasterPlanStore, projectId: string): MasterPlan | null {
    return store.loadLatest(projectId);
  }
}
