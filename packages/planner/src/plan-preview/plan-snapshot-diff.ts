import { signedUsd, signedWindowPercent } from "./money.js";
import type { PlanDelta, PlanSnapshot } from "./types.js";

export function taskDeltaLabel(before: number, after: number): string {
  const delta = after - before;
  const noun = Math.abs(delta) === 1 ? "task" : "tasks";
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toString()} ${noun}`;
}

export function reverifiedLabel(count: number): string {
  const noun = count === 1 ? "task" : "tasks";
  return `${count.toString()} ${noun} re-verified`;
}

export class PlanSnapshotDiffer {
  diff(input: {
    readonly before: PlanSnapshot;
    readonly after: PlanSnapshot;
    readonly reverifiedTaskCount: number;
    readonly approvalReason: string;
  }): PlanDelta {
    const taskDelta = taskDeltaLabel(input.before.taskCount, input.after.taskCount);
    const reverified = reverifiedLabel(input.reverifiedTaskCount);
    const costDelta =
      input.after.connection === "subscription"
        ? signedWindowPercent(input.after.windowPpm - input.before.windowPpm)
        : signedUsd(input.after.costMicroUsd - input.before.costMicroUsd);
    const beforeDeps = new Set(input.before.dependencies);
    const afterDeps = new Set(input.after.dependencies);
    const notes: string[] = [];
    for (const name of [...afterDeps].sort()) {
      if (!beforeDeps.has(name)) notes.push(`Adds new dependency: ${name}`);
    }
    for (const name of [...beforeDeps].sort()) {
      if (!afterDeps.has(name)) notes.push(`Removes dependency: ${name}`);
    }
    return {
      headline: "Before → After Plan Delta",
      taskDeltaLabel: taskDelta,
      reverifiedLabel: reverified,
      costDeltaLabel: costDelta,
      dependencyNotes: notes,
      approvalReason: input.approvalReason,
      lines: [taskDelta, reverified, costDelta, ...notes, input.approvalReason],
    };
  }
}
