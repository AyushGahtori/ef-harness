import type { LoopDetectorReading, WorkerStep } from "./types.js";

export interface LoopMeasurement {
  readonly identicalFailingTools: number;
  readonly editUndoOscillation: number;
  readonly repeatingTestErrors: number;
  readonly count: number;
  readonly errorSnippet: string | null;
}

function byIndex(steps: readonly WorkerStep[]): WorkerStep[] {
  return [...steps].sort((left, right) => left.index - right.index);
}

function trailingIdenticalFailedTools(steps: readonly WorkerStep[]): number {
  const last = steps.at(-1);
  if (!last || last.kind !== "tool" || !last.failed) return 0;
  let count = 0;
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (!step || step.kind !== "tool" || !step.failed) break;
    if (step.fingerprint !== last.fingerprint || step.toolName !== last.toolName) break;
    count += 1;
  }
  return count;
}

function trailingEditUndoRun(steps: readonly WorkerStep[]): number {
  const last = steps.at(-1);
  if (!last || (last.kind !== "edit" && last.kind !== "undo")) return 0;
  let count = 1;
  for (let index = steps.length - 1; index > 0; index -= 1) {
    const current = steps[index];
    const previous = steps[index - 1];
    if (!current || !previous) break;
    const currentFlip = current.kind === "edit" || current.kind === "undo";
    const previousFlip = previous.kind === "edit" || previous.kind === "undo";
    if (!currentFlip || !previousFlip || current.kind === previous.kind) break;
    count += 1;
  }
  return count;
}

function trailingIdenticalFailedTests(steps: readonly WorkerStep[]): number {
  const last = steps.at(-1);
  if (!last || last.kind !== "test" || !last.failed) return 0;
  let count = 0;
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (!step || step.kind !== "test" || !step.failed) break;
    if (step.fingerprint !== last.fingerprint) break;
    count += 1;
  }
  return count;
}

function lastErrorSnippet(steps: readonly WorkerStep[]): string | null {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step?.errorSnippet) return step.errorSnippet;
  }
  return null;
}

export function measureSteps(steps: readonly WorkerStep[]): LoopMeasurement {
  const ordered = byIndex(steps);
  const identicalFailingTools = trailingIdenticalFailedTools(ordered);
  const editUndoOscillation = trailingEditUndoRun(ordered);
  const repeatingTestErrors = trailingIdenticalFailedTests(ordered);
  return {
    identicalFailingTools,
    editUndoOscillation,
    repeatingTestErrors,
    count: Math.max(identicalFailingTools, editUndoOscillation, repeatingTestErrors),
    errorSnippet: lastErrorSnippet(ordered),
  };
}

/** The sibling detector and the local step counter agree when either reaches 3. */
export function combineLoopReadings(
  reading: LoopDetectorReading,
  steps: readonly WorkerStep[],
): LoopMeasurement {
  const measured = measureSteps(steps);
  const identicalFailingTools = Math.max(
    reading.identicalFailingToolInvocations,
    measured.identicalFailingTools,
  );
  const editUndoOscillation = Math.max(reading.editUndoOscillations, measured.editUndoOscillation);
  const repeatingTestErrors = Math.max(
    reading.repeatingTestErrorFingerprints,
    measured.repeatingTestErrors,
  );
  return {
    identicalFailingTools,
    editUndoOscillation,
    repeatingTestErrors,
    count: Math.max(identicalFailingTools, editUndoOscillation, repeatingTestErrors),
    errorSnippet: reading.errorSnippet ?? measured.errorSnippet,
  };
}
