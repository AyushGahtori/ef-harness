export interface PendingTarget<T extends string> {
  readonly target: T;
  readonly sinceMs: number;
}

export interface HysteresisTransition<T extends string> {
  readonly from: T;
  readonly to: T;
  readonly elapsedMs: number;
  readonly emergency: boolean;
}

export interface HysteresisStep<T extends string> {
  readonly level: T;
  readonly pending: PendingTarget<T> | null;
  readonly transition: HysteresisTransition<T> | null;
}

/**
 * Asymmetric debounce: worsening waits `enterMs` (unless `instant`),
 * recovery waits `recoverMs` (unless `instantRecovery`).
 */
export function stepHysteresis<T extends string>(input: {
  readonly level: T;
  readonly pending: PendingTarget<T> | null;
  readonly target: T;
  readonly nowMs: number;
  readonly rank: (value: T) => number;
  readonly enterMs: number;
  readonly recoverMs: number;
  readonly instant: boolean;
  readonly instantRecovery: boolean;
}): HysteresisStep<T> {
  const targetRank = input.rank(input.target);
  const levelRank = input.rank(input.level);

  if (input.instant && targetRank > levelRank) {
    return {
      level: input.target,
      pending: null,
      transition: {
        from: input.level,
        to: input.target,
        elapsedMs: 0,
        emergency: true,
      },
    };
  }

  if (input.instantRecovery && targetRank < levelRank) {
    return {
      level: input.target,
      pending: null,
      transition: {
        from: input.level,
        to: input.target,
        elapsedMs: 0,
        emergency: false,
      },
    };
  }

  if (input.target === input.level) {
    return { level: input.level, pending: null, transition: null };
  }

  const pending =
    input.pending && input.pending.target === input.target
      ? input.pending
      : { target: input.target, sinceMs: input.nowMs };
  const worsening = targetRank > levelRank;
  const elapsed = input.nowMs - pending.sinceMs;
  const need = worsening ? input.enterMs : input.recoverMs;
  if (elapsed >= need) {
    return {
      level: input.target,
      pending: null,
      transition: {
        from: input.level,
        to: input.target,
        elapsedMs: elapsed,
        emergency: false,
      },
    };
  }
  return { level: input.level, pending, transition: null };
}
