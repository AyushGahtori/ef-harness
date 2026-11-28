import {
  DEVELOPER_OWNER_ROLES,
  PRIORITY_RANK,
  type HumanReason,
  type PriorityTier,
  type QuestionKind,
} from "./constants.js";
import type { PrioritySignals, QuestionCard } from "./types.js";

export function emptySignals(): PrioritySignals {
  return {
    stop: false,
    security: false,
    authExpiry: false,
    budgetCap: false,
    criticalBlocker: false,
  };
}

export function normalizeSignals(input?: Partial<PrioritySignals>): PrioritySignals {
  return {
    stop: input?.stop === true,
    security: input?.security === true,
    authExpiry: input?.authExpiry === true,
    budgetCap: input?.budgetCap === true,
    criticalBlocker: input?.criticalBlocker === true,
  };
}

export function isInterruptSignal(signals: PrioritySignals): boolean {
  return signals.stop || signals.security || signals.authExpiry || signals.budgetCap || signals.criticalBlocker;
}

export function humanReasonFor(kind: QuestionKind): HumanReason {
  switch (kind) {
    case "technical":
    case "escalation":
      return "unresolvable_escalation";
    case "product":
      return "unsettled_product_behavior";
    case "secret":
      return "secret";
    case "approval":
      return "approval";
    case "human_step":
      return "human_step";
    case "dispute_test":
      return "dispute_test";
    case "breaking_ccr":
    case "conflict":
      return "breaking_ccr";
    case "ambiguous_steering":
      return "ambiguous_steering";
    case "advisory":
      return "advisory";
    default: {
      const unexpected: never = kind;
      return unexpected;
    }
  }
}

export function requiresHumanJudgment(kind: QuestionKind): boolean {
  return kind !== "technical";
}

export function isInternalAgentOwner(role: string): boolean {
  return !DEVELOPER_OWNER_ROLES.has(role);
}

export function classifyPriority(input: {
  readonly kind: QuestionKind;
  readonly onCriticalPath: boolean;
  readonly blockedWorkerCount: number;
  readonly signals: PrioritySignals;
}): PriorityTier {
  if (isInterruptSignal(input.signals)) return "P0";
  if (input.kind === "advisory") return "P4";
  if (input.onCriticalPath || input.blockedWorkerCount >= 2) return "P1";
  if (
    input.kind === "breaking_ccr" ||
    input.kind === "conflict" ||
    input.kind === "dispute_test" ||
    input.kind === "ambiguous_steering"
  ) {
    return "P2";
  }
  return "P3";
}

export function priorityRank(tier: PriorityTier): number {
  return PRIORITY_RANK[tier];
}

export function holdModeFor(tier: PriorityTier): "HARD_HOLD" | "SOFT_HOLD" {
  return tier === "P0" || tier === "P1" ? "HARD_HOLD" : "SOFT_HOLD";
}

export function placesWorkerHold(kind: QuestionKind): boolean {
  return kind !== "advisory";
}

export function countsAsHumanInterruption(tier: PriorityTier): boolean {
  return tier !== "P4";
}

export function compareCards(left: QuestionCard, right: QuestionCard): number {
  if (left.priorityRank !== right.priorityRank) return right.priorityRank - left.priorityRank;
  if (left.blockedWorkerCount !== right.blockedWorkerCount) {
    return right.blockedWorkerCount - left.blockedWorkerCount;
  }
  if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt;
  if (left.questionId < right.questionId) return -1;
  if (left.questionId > right.questionId) return 1;
  return 0;
}

export function canonicalInboxKind(kind: QuestionKind): string {
  switch (kind) {
    case "secret":
      return "secret";
    case "approval":
      return "approval";
    case "human_step":
      return "human_step";
    case "conflict":
      return "conflict";
    case "advisory":
      return "fyi";
    default:
      return "question";
  }
}

export function canonicalInboxStatus(status: QuestionCard["status"]): "open" | "answered" | "superseded" | "dismissed" {
  if (status === "retired") return "dismissed";
  return status;
}
