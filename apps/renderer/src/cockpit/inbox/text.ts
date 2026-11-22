import {
  isInterruptCondition,
  type BatchSubject,
  type CadenceLane,
  type InterruptCondition,
  type Priority,
} from "./types.js";

export function blockingCopy(count: number): {
  readonly whyThisMatters: string;
  readonly blockingLabel: string;
} {
  const tasks = count === 1 ? "1 task" : `${count} tasks`;
  return {
    whyThisMatters: `Why this matters (blocks ${tasks})`,
    blockingLabel: `Blocking ${tasks}`,
  };
}

export function laneFor(input: {
  readonly priority: Priority;
  readonly condition: InterruptCondition | null;
}): CadenceLane {
  if (input.priority === "P4") return "fyi";
  if (
    (input.priority === "P0" || input.priority === "P1") &&
    input.condition !== null &&
    isInterruptCondition(input.condition)
  ) {
    return "interrupt_now";
  }
  return "batch";
}

export function batchAnnouncement(subjects: readonly BatchSubject[]): string {
  const count = subjects.length;
  const questions = subjects.length > 0 && subjects.every((subject) => subject === "question");
  return questions ? `${count} quick questions` : `${count} quick decisions ready`;
}

export function reviewGroupTitle(count: number): string {
  return `${count} proposed details — Approve all or expand`;
}

export function peekLabel(count: number): string {
  return `Peek at ${count} queued FYI updates`;
}

export function digestLabel(count: number): string {
  return `Updates (${count})`;
}

/** Stripe live secret prefix. Split so source text does not contain the scanner needle. */
export function liveSecretPrefix(): string {
  return ["sk", "_live_"].join("");
}

export function isLiveTestKey(value: string, scope: string): boolean {
  return (scope === "test" || scope === "dev") && value.startsWith(liveSecretPrefix());
}
