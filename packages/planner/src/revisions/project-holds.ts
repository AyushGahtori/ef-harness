import type { TaskHoldAndSubmissionRepo } from "@ef-harness/db";
import type { TaskHoldsPort } from "./ports.js";

/** Places revision holds through `TaskHoldAndSubmissionRepo` with `requirement_change`. */
export class ProjectStateHoldWriter implements TaskHoldsPort {
  constructor(
    private readonly holds: TaskHoldAndSubmissionRepo,
    private readonly rev: () => number,
  ) {}

  placeHold(input: {
    readonly taskId: string;
    readonly reason: "requirement_change";
    readonly source: string;
    readonly createdAt: number;
  }): void {
    this.holds.placeHold({
      task: input.taskId,
      reason: "requirement_change",
      source: input.source,
      now: input.createdAt,
      rev: this.rev(),
    });
  }
}
