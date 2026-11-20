import { FeaturePlanError } from "./errors.js";
import type { HiddenCheckPoolStore } from "./hidden-check-pool-store.js";
import type { FeaturePlanDocument, RequirementInput, WorkerBrief } from "./types.js";

const SEALED_ID_MARK = "sealed-";

export function compileWorkerBrief(input: {
  readonly plan: FeaturePlanDocument;
  readonly taskId: string;
  readonly requirements: readonly RequirementInput[];
  readonly store: HiddenCheckPoolStore;
}): WorkerBrief {
  const task = [...input.plan.tasks, input.plan.integration].find((item) => item.id === input.taskId);
  if (!task) {
    throw new FeaturePlanError("dangling_node", `Task ${input.taskId} is not in the feature plan`, {
      nodeId: input.taskId,
    });
  }
  const requirements = input.requirements.filter((requirement) => task.requirementIds.includes(requirement.id));
  const hidden = input.store.listForRequirements(task.requirementIds);
  const brief: WorkerBrief = {
    schema: "task-packet@1",
    task: task.id,
    goal: task.goal,
    write_scope: task.writeScope,
    must: requirements.map((requirement) => ({ id: requirement.id, text: requirement.ears })),
    checks_visible: task.checks.map((check) => check.id),
    checks_visible_examples: task.checks.map((check) => ({
      id: check.id,
      entry_point: check.entryPoint,
      input: check.example.input,
      expected: check.example.expected,
      assertion: check.example.assertion,
    })),
    checks_hidden_count: hidden.length,
  };
  const blob = JSON.stringify(brief);
  if (blob.includes(SEALED_ID_MARK)) {
    throw new FeaturePlanError("worker_blind", "A sealed check id leaked into the worker brief", { taskId: task.id });
  }
  for (const row of hidden) {
    const content = row.contentJson;
    if (content.length > 0 && blob.includes(content)) {
      throw new FeaturePlanError("worker_blind", "Sealed check content leaked into the worker brief", {
        taskId: task.id,
      });
    }
  }
  return brief;
}
