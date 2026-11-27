import { FeaturePlanError } from "./errors.js";
import { lintOracleCase } from "./oracle-lint.js";
import type { PlanContext } from "./ports.js";
import { assertDisjointWriteScopes, assertTaskBounds } from "./scope.js";
import type { FeaturePlanDocument, PlannedCheck, PlannedTask } from "./types.js";

export function validateFeaturePlan(document: FeaturePlanDocument, context: PlanContext): void {
  if (document.integration.taskType !== "feature_integration" || document.integration.integrationSlot !== "096") {
    throw new FeaturePlanError("missing_integration_slot", "Feature plan is missing the Task 096 integration slot", {
      featureId: document.featureId,
    });
  }
  if (document.tasks.some((task) => task.taskType === "feature_integration")) {
    throw new FeaturePlanError("missing_integration_slot", "Feature integration slot must be a single dedicated task");
  }
  const all = [...document.tasks, document.integration];
  const ids = all.map((task) => task.id);
  assertUnique(ids, "Duplicate task id");
  for (const task of all) {
    assertTaskBounds(task);
    assertTouches(task);
    assertVisibleChecks(task);
    if (task.dependsOn.includes(task.id)) {
      throw new FeaturePlanError("dangling_node", `Task ${task.id} depends on itself`, { nodeId: task.id });
    }
    for (const dependency of task.dependsOn) {
      if (!ids.includes(dependency)) {
        throw new FeaturePlanError("dangling_node", `Task ${task.id} depends on missing task ${dependency}`, {
          nodeId: dependency,
        });
      }
    }
  }
  assertDisjointWriteScopes(all);
  const leaves = document.tasks.filter((task) => task.taskType === "leaf");
  for (const leaf of leaves) {
    if (leaf.dependsOn.includes(document.integration.id)) {
      throw new FeaturePlanError("invalid_model_output", `Leaf ${leaf.id} cannot depend on the integration slot`);
    }
  }
  for (const leaf of leaves) {
    if (!document.integration.dependsOn.includes(leaf.id)) {
      throw new FeaturePlanError(
        "invalid_model_output",
        `Integration slot must depend on leaf ${leaf.id}`,
        { taskId: leaf.id },
      );
    }
  }
  if (!document.integration.checks.some((check) => check.id === document.journeyCheck.id)) {
    throw new FeaturePlanError("missing_visible_check", "Feature integration slot must carry the journey check");
  }
  const requirementIds = new Set(context.requirements.map((requirement) => requirement.id));
  const contractIds = new Set(context.contracts.map((contract) => contract.id));
  const entityIds = new Set(context.entities.map((entity) => entity.id));
  for (const task of all) {
    for (const requirementId of task.requirementIds) {
      if (!requirementIds.has(requirementId)) {
        throw new FeaturePlanError(
          "dangling_node",
          `Task ${task.id} references ${requirementId} which does not exist`,
          { nodeId: requirementId },
        );
      }
    }
    for (const contractId of task.contractIds) {
      if (!contractIds.has(contractId)) {
        throw new FeaturePlanError("dangling_node", `Task ${task.id} consumes missing contract ${contractId}`, {
          nodeId: contractId,
        });
      }
    }
    for (const entityId of task.entityIds) {
      const entity = context.entities.find((item) => item.id === entityId);
      if (!entity || !entityIds.has(entityId)) {
        throw new FeaturePlanError("dangling_node", `Task ${task.id} touches missing entity ${entityId}`, {
          nodeId: entityId,
        });
      }
      for (const tag of entity.touches) {
        if (!task.touches.includes(tag)) {
          throw new FeaturePlanError(
            "closed_tag",
            `Task ${task.id} touches entity ${entityId} but omits inherited tag ${tag}`,
            { taskId: task.id, tag },
          );
        }
      }
    }
  }
  const seenChecks = new Set<string>();
  for (const task of all) {
    for (const check of task.checks) {
      if (seenChecks.has(check.id) && check.id !== document.journeyCheck.id) {
        throw new FeaturePlanError("invalid_model_output", `Duplicate check id ${check.id}`, { id: check.id });
      }
      seenChecks.add(check.id);
    }
  }
  for (const requirement of context.requirements) {
    const owners = leaves.filter((task) => task.requirementIds.includes(requirement.id));
    if (owners.length === 0) {
      throw new FeaturePlanError(
        "uncovered_requirement",
        `Requirement ${requirement.id} has no implementing leaf task`,
        { nodeId: requirement.id },
      );
    }
    const visible = owners.flatMap((task) => task.checks).filter((check) => check.requirementIds.includes(requirement.id));
    if (visible.length === 0) {
      throw new FeaturePlanError(
        "missing_visible_check",
        `Requirement ${requirement.id} has no visible acceptance check`,
        { nodeId: requirement.id },
      );
    }
  }
}

function assertTouches(task: PlannedTask): void {
  if (task.touches.length === 0) {
    throw new FeaturePlanError("closed_tag", `Task ${task.id} declares no touches tags`, { taskId: task.id });
  }
}

function assertVisibleChecks(task: PlannedTask): void {
  for (const check of task.checks) {
    assertCheckClean(check);
  }
}

function assertCheckClean(check: PlannedCheck): void {
  const issues = lintOracleCase({
    assertion: check.example.assertion,
    input: check.example.input,
    expected: check.example.expected,
    entryPoint: check.entryPoint,
    kind: check.kind,
  });
  if (issues.length > 0) {
    throw new FeaturePlanError("weak_visible_check", `Visible check ${check.id} failed the oracle lint`, {
      checkId: check.id,
      issues: issues.map((issue) => issue.code),
    });
  }
}

function assertUnique(ids: readonly string[], message: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new FeaturePlanError("invalid_model_output", `${message} ${id}`, { id });
    }
    seen.add(id);
  }
}
