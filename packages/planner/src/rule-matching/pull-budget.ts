import { MAX_PULL_BYTES_PER_TURN, MAX_PULL_CALLS_PER_TURN } from "./types.js";

interface TurnUsage {
  calls: number;
  bytes: number;
}

export function turnBudgetKey(attemptId: string, turnId: string): string {
  return `${attemptId}\u0000${turnId}`;
}

/** Per-turn ceiling: 25 calls and 24 KB of returned text. Turns do not share a budget. */
export class PullTurnBudget {
  private readonly turns = new Map<string, TurnUsage>();

  constructor(
    private readonly maxCalls = MAX_PULL_CALLS_PER_TURN,
    private readonly maxBytes = MAX_PULL_BYTES_PER_TURN,
  ) {}

  usage(turnKey: string): { calls: number; bytes: number } {
    const state = this.turns.get(turnKey) ?? { calls: 0, bytes: 0 };
    return { calls: state.calls, bytes: state.bytes };
  }

  hasCallRoom(turnKey: string): boolean {
    return this.usage(turnKey).calls < this.maxCalls;
  }

  hasByteRoom(turnKey: string): boolean {
    return this.usage(turnKey).bytes < this.maxBytes;
  }

  /**
   * Reserves one call. Adds `payloadBytes` only when the payload fits.
   * A payload that would pass 24 KB consumes the call and is not returned.
   */
  consume(turnKey: string, payloadBytes: number): boolean {
    const state = this.turns.get(turnKey) ?? { calls: 0, bytes: 0 };
    if (state.calls >= this.maxCalls) {
      this.turns.set(turnKey, state);
      return false;
    }
    if (payloadBytes < 0 || state.bytes + payloadBytes > this.maxBytes) {
      state.calls += 1;
      this.turns.set(turnKey, state);
      return false;
    }
    state.calls += 1;
    state.bytes += payloadBytes;
    this.turns.set(turnKey, state);
    return true;
  }
}
