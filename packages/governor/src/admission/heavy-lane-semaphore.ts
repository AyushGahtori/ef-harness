import { HEAVY_LANE_PRIORITY_WEIGHT, maxHeavyPermits } from "./thresholds.js";
import type { CommandClass, HeavyLaneRole, PressureLevel } from "./types.js";

export interface HeavyLaneRequest {
  readonly id: string;
  readonly role: HeavyLaneRole;
  readonly commandClass: CommandClass;
  readonly projectId: string;
}

export interface HeavyLaneTicket {
  readonly id: string;
  readonly role: HeavyLaneRole;
  readonly commandClass: CommandClass;
  readonly projectId: string;
  state: "queued" | "granted" | "released";
  readonly sequence: number;
}

/**
 * Fair weighted semaphore. Each heavy command takes one permit.
 * Queue order is verifier, then worker, then background, FIFO inside a role.
 * In-flight holders are not revoked when the cap shrinks.
 */
export class HeavyLaneSemaphore {
  private readonly held = new Map<string, HeavyLaneTicket>();
  private readonly waiters: HeavyLaneTicket[] = [];
  private sequence = 0;
  private settleScheduled = false;
  private level: PressureLevel;

  constructor(
    private readonly totalRamMb: number,
    level: PressureLevel = "GREEN",
  ) {
    this.level = level;
  }

  get permitCap(): number {
    return maxHeavyPermits(this.totalRamMb, this.level);
  }

  get heldCount(): number {
    return this.held.size;
  }

  heldIds(): readonly string[] {
    return [...this.held.keys()];
  }

  queuedIds(): readonly string[] {
    return this.orderedWaiters().map((ticket) => ticket.id);
  }

  enqueue(request: HeavyLaneRequest): HeavyLaneTicket {
    if (this.held.has(request.id) || this.waiters.some((ticket) => ticket.id === request.id)) {
      throw new Error(`Heavy-lane id ${request.id} is already tracked`);
    }
    const ticket: HeavyLaneTicket = {
      ...request,
      state: "queued",
      sequence: this.sequence,
    };
    this.sequence += 1;
    this.waiters.push(ticket);
    this.scheduleSettle();
    return ticket;
  }

  release(id: string): HeavyLaneTicket | null {
    const ticket = this.held.get(id);
    if (!ticket) throw new Error(`Heavy-lane permit ${id} is not held`);
    this.held.delete(id);
    ticket.state = "released";
    const granted = this.grantAvailable();
    return granted[0] ?? null;
  }

  setPressure(level: PressureLevel): void {
    this.level = level;
    this.grantAvailable();
  }

  settle(): readonly HeavyLaneTicket[] {
    this.settleScheduled = false;
    return this.grantAvailable();
  }

  private scheduleSettle(): void {
    if (this.settleScheduled) return;
    this.settleScheduled = true;
    queueMicrotask(() => {
      if (!this.settleScheduled) return;
      this.settleScheduled = false;
      this.grantAvailable();
    });
  }

  private grantAvailable(): HeavyLaneTicket[] {
    const granted: HeavyLaneTicket[] = [];
    while (this.held.size < this.permitCap) {
      const next = this.orderedWaiters()[0];
      if (!next) break;
      const index = this.waiters.findIndex((ticket) => ticket.id === next.id);
      if (index >= 0) this.waiters.splice(index, 1);
      next.state = "granted";
      this.held.set(next.id, next);
      granted.push(next);
    }
    return granted;
  }

  private orderedWaiters(): readonly HeavyLaneTicket[] {
    return [...this.waiters].sort((left, right) => {
      const byWeight = HEAVY_LANE_PRIORITY_WEIGHT[right.role] - HEAVY_LANE_PRIORITY_WEIGHT[left.role];
      if (byWeight !== 0) return byWeight;
      return left.sequence - right.sequence;
    });
  }
}
