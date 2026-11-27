import { filesForTask } from "./foundation-files.js";
import type { Phase0TaskWorker, TaskExecution, TaskExecutionContext } from "./ports.js";

export class DefaultPhase0Worker implements Phase0TaskWorker {
  async execute(context: TaskExecutionContext): Promise<TaskExecution> {
    return {
      files: { ...filesForTask(context.task.id, context.projectKind) },
      dependencyIntents: context.task.dependencyIntents ?? [],
      attemptedCommands: [],
    };
  }
}
