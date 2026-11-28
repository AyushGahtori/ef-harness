import {
  AGING_WINDOW_MS,
  CRITICAL_PATH_BONUS,
  MAX_WAIT_BOOST,
  ROLE_BASE_SCORE,
  type LeaseRole,
} from "./types.js";

export interface PriorityCandidate {
  readonly role: LeaseRole;
  readonly criticalPath: boolean;
  readonly seq: number;
  readonly enqueuedAt: number;
}

/** Bounded, monotonic boost for Active Workers. It caps at 60s and then beats a fresh verifier. */
export function workerAgingBoost(waitedMs: number): number {
  if (waitedMs <= 0) return 0;
  const capped = Math.min(waitedMs, AGING_WINDOW_MS);
  return Math.floor((capped / AGING_WINDOW_MS) * MAX_WAIT_BOOST);
}

export function executionPriorityScore(input: {
  readonly role: LeaseRole;
  readonly waitedMs: number;
  readonly criticalPath: boolean;
}): number {
  const waited = Math.max(0, input.waitedMs);
  const aging = input.role === "worker" ? workerAgingBoost(waited) : 0;
  const critical = input.criticalPath && input.role === "worker" ? CRITICAL_PATH_BONUS : 0;
  return ROLE_BASE_SCORE[input.role] + aging + critical;
}

/** Higher score first. Equal scores keep a verifier ahead of a tied worker, then FIFO. */
export function compareExecutionPriority(
  left: PriorityCandidate,
  right: PriorityCandidate,
  now: number,
): number {
  const leftScore = executionPriorityScore({
    role: left.role,
    waitedMs: now - left.enqueuedAt,
    criticalPath: left.criticalPath,
  });
  const rightScore = executionPriorityScore({
    role: right.role,
    waitedMs: now - right.enqueuedAt,
    criticalPath: right.criticalPath,
  });
  if (leftScore !== rightScore) return rightScore - leftScore;
  const baseGap = ROLE_BASE_SCORE[right.role] - ROLE_BASE_SCORE[left.role];
  if (baseGap !== 0) return baseGap;
  return left.seq - right.seq;
}
