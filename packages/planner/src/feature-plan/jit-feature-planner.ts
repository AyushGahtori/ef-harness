import { FeaturePlanError } from "./errors.js";
import { buildPlannerModelInput } from "./model-input.js";
import { selectPlannerModel } from "./model-family.js";
import type { FeatureArchitectureConsistency, PlanContext } from "./ports.js";
import { FeaturePlannerV1Schema } from "./schema.js";
import type { FeaturePlanDocument, ModelRoster, PlannerOracleModel } from "./types.js";
import { validateFeaturePlan } from "./validate-plan.js";

export interface PlannerRun {
  readonly context: PlanContext;
  readonly model: PlannerOracleModel;
  readonly roster: ModelRoster;
}

export interface ReplanRun extends PlannerRun {
  readonly previous: FeaturePlanDocument;
  readonly impactedRequirementIds: readonly string[];
}

/**
 * Just-in-time feature-planner@1. Decomposes one feature into bounded leaf
 * tasks plus the Task 096 integration slot, after architecture consistency passes.
 */
export class JitFeaturePlanner {
  async plan(input: PlannerRun): Promise<FeaturePlanDocument> {
    assertArchitectureReady(input.context.architecture, input.context.featureId);
    const assignment = selectPlannerModel(input.roster);
    const output = await input.model.complete({
      role: "feature-planner@1",
      family: assignment.family,
      model: assignment.model,
      input: buildPlannerModelInput(input.context, input.context.requirements),
      repair: null,
    });
    const document = FeaturePlannerV1Schema.parse(output, input.context.featureId);
    validateFeaturePlan(document, input.context);
    return document;
  }

  async replan(input: ReplanRun): Promise<FeaturePlanDocument> {
    assertArchitectureReady(input.context.architecture, input.context.featureId);
    const impacted = new Set(input.impactedRequirementIds);
    if (impacted.size === 0) {
      throw new FeaturePlanError("incremental_scope", "Incremental re-plan needs at least one impacted requirement");
    }
    const subset = input.context.requirements.filter((requirement) => impacted.has(requirement.id));
    if (subset.length !== impacted.size) {
      const missing = [...impacted].find((id) => !subset.some((requirement) => requirement.id === id)) ?? "";
      throw new FeaturePlanError("dangling_node", `Impacted requirement ${missing} does not exist`, { nodeId: missing });
    }
    const assignment = selectPlannerModel(input.roster);
    const output = await input.model.complete({
      role: "feature-planner@1",
      family: assignment.family,
      model: assignment.model,
      input: buildPlannerModelInput(input.context, subset),
      repair: null,
    });
    const delta = FeaturePlannerV1Schema.parse(output, input.context.featureId);
    for (const task of delta.tasks) {
      if (task.requirementIds.some((id) => !impacted.has(id))) {
        throw new FeaturePlanError(
          "incremental_scope",
          `Re-plan tried to rewrite ${task.id} outside the impacted requirements`,
          { taskId: task.id },
        );
      }
    }
    const kept = input.previous.tasks.filter((task) => !task.requirementIds.some((id) => impacted.has(id)));
    const merged: FeaturePlanDocument = {
      schema: input.previous.schema,
      featureId: input.previous.featureId,
      tasks: [...kept, ...delta.tasks],
      integration: input.previous.integration,
      journeyCheck: input.previous.journeyCheck,
    };
    const leafIds = merged.tasks.filter((task) => task.taskType === "leaf").map((task) => task.id);
    const sameDependencies =
      leafIds.length === merged.integration.dependsOn.length &&
      leafIds.every((id) => merged.integration.dependsOn.includes(id));
    if (!sameDependencies) {
      throw new FeaturePlanError(
        "incremental_scope",
        "Re-plan changed the integration slot dependency set; keep unaffected leaves and the integration slot intact",
      );
    }
    validateFeaturePlan(merged, input.context);
    return merged;
  }
}

function assertArchitectureReady(architecture: FeatureArchitectureConsistency, featureId: string): void {
  if (architecture.schema !== "feature-architect@1" || architecture.featureId !== featureId || !architecture.passed) {
    throw new FeaturePlanError(
      "architecture_not_ready",
      `Feature ${featureId} cannot be planned until feature architecture passes consistency`,
      { failures: architecture.failures },
    );
  }
}
