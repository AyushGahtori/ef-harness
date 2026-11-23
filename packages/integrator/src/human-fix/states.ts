import type { TaskState } from "./types.js";
import { IllegalTaskTransitionError } from "./errors.js";
import { HUMAN_OWNED, HUMAN_OWNED_ENTRY_STATES, STATIC_AUDIT } from "./constants.js";

const ENTRY_SET = new Set<string>(HUMAN_OWNED_ENTRY_STATES);

const LEGAL: Readonly<Partial<Record<TaskState, readonly TaskState[]>>> = {
  CODING: ["STATIC_AUDIT", "WAITING_INPUT", "PARKED", "HUMAN_OWNED", "CANCELLED"],
  WAITING_INPUT: ["CODING", "PARKED", "HUMAN_OWNED", "CANCELLED"],
  PARKED: ["READY", "HUMAN_OWNED", "CANCELLED"],
  ESCALATED: ["READY", "HUMAN_OWNED", "CANCELLED"],
  EXHAUSTED: ["READY", "HUMAN_OWNED", "CANCELLED"],
  HUMAN_OWNED: ["STATIC_AUDIT", "CODING", "CANCELLED"],
  STATIC_AUDIT: ["CLEAN_VERIFY", "CODING", "PARKED", "CANCELLED"],
  CLEAN_VERIFY: ["ACCEPTED", "CODING", "ESCALATED", "PARKED", "CANCELLED"],
};

export function canEnterHumanOwned(from: TaskState): boolean {
  return ENTRY_SET.has(from);
}

export function assertLegalTransition(from: TaskState, to: TaskState): void {
  if (from === to) return;
  const allowed = LEGAL[from];
  if (!allowed?.includes(to)) {
    throw new IllegalTaskTransitionError(from, to);
  }
}

export function transitionToHumanOwned(from: TaskState): typeof HUMAN_OWNED {
  if (!canEnterHumanOwned(from)) {
    throw new IllegalTaskTransitionError(from, HUMAN_OWNED);
  }
  return HUMAN_OWNED;
}

export function transitionHumanDone(from: TaskState): typeof STATIC_AUDIT {
  if (from !== HUMAN_OWNED) {
    throw new IllegalTaskTransitionError(from, STATIC_AUDIT);
  }
  return STATIC_AUDIT;
}