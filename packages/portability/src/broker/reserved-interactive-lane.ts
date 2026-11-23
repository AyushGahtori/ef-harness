import type { PacingCwndPort } from "./types.js";

/**
 * One reserved interactive fast-lane slot per active connection when cwnd >= 2;
 * when cwnd === 1, interactive still wins on the next turn boundary (preemption).
 */
export class ReservedInteractiveLanePerConnection {
  private readonly interactiveInFlight = new Map<string, number>();
  private readonly pacing: PacingCwndPort;

  constructor(pacing: PacingCwndPort) {
    this.pacing = pacing;
  }

  canDispatchFastLane(connectionId: string): boolean {
    const cwnd = this.pacing.getCwnd(connectionId);
    const inFlight = this.interactiveInFlight.get(connectionId) ?? 0;
    if (cwnd >= 2) {
      return inFlight < 1;
    }
    return inFlight < 1;
  }

  markDispatched(connectionId: string): void {
    this.interactiveInFlight.set(connectionId, (this.interactiveInFlight.get(connectionId) ?? 0) + 1);
  }

  release(connectionId: string): void {
    const next = (this.interactiveInFlight.get(connectionId) ?? 0) - 1;
    if (next <= 0) {
      this.interactiveInFlight.delete(connectionId);
    } else {
      this.interactiveInFlight.set(connectionId, next);
    }
  }
}