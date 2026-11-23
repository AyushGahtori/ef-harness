import {
  MachineCapacityExceededError,
  PortLeaseCollisionError,
  PortOutOfRangeError,
} from "./errors.js";
import type {
  ExecutionRole,
  ExecutionSlotRequest,
  MachineCapacityLimits,
  PortLeaseRow,
} from "./types.js";
import { PORT_LEASE_MAX, PORT_LEASE_MIN } from "./types.js";

const ROLE_RANK: Record<ExecutionRole, number> = {
  verifier: 0,
  worker: 1,
  background: 2,
  batch: 3,
};

interface ActiveSlot {
  readonly requestId: string;
  readonly projectId: string;
  readonly executionRole: ExecutionRole;
  readonly heavy: boolean;
}

interface Waiter extends ExecutionSlotRequest {
  resolve: (token: SlotToken) => void;
  reject: (error: Error) => void;
}

export interface SlotToken {
  readonly tokenId: string;
  release(): void;
}

export class MachineWideSlotCoordinator {
  private limits: MachineCapacityLimits;
  private readonly activePool2: ActiveSlot[] = [];
  private readonly activeHeavy: ActiveSlot[] = [];
  private readonly waiters: Waiter[] = [];
  private readonly portLeases = new Map<number, PortLeaseRow>();
  private tokenSeq = 0;

  constructor(limits: MachineCapacityLimits) {
    this.limits = { ...limits };
  }

  setGovernorOrange(singleSlot: boolean): void {
    this.limits = {
      ...this.limits,
      pool2WarmSlots: singleSlot ? 1 : this.limits.pool2WarmSlots,
      heavyLanePermits: singleSlot ? 1 : this.limits.heavyLanePermits,
    };
  }

  async acquireExecutionSlot(request: ExecutionSlotRequest): Promise<SlotToken> {
    if (this.canGrantImmediately(request)) {
      return this.grantSlot(request);
    }
    return new Promise<SlotToken>((resolve, reject) => {
      this.waiters.push({ ...request, resolve, reject });
      this.waiters.sort((a, b) => this.compareWaiters(a, b));
      this.pumpWaiters();
    });
  }

  leasePort(
    port: number,
    projectId: string,
    environment: string,
    nowMs: number,
    expiresAtMs: number | null,
  ): PortLeaseRow {
    if (port < PORT_LEASE_MIN || port > PORT_LEASE_MAX) {
      throw new PortOutOfRangeError(port);
    }
    const existing = this.portLeases.get(port);
    if (existing && existing.projectId !== projectId) {
      throw new PortLeaseCollisionError(port, existing.projectId);
    }
    const row: PortLeaseRow = {
      port,
      projectId,
      environment,
      leasedAtMs: nowMs,
      expiresAtMs,
    };
    this.portLeases.set(port, row);
    return row;
  }

  releasePort(port: number, projectId: string): void {
    const existing = this.portLeases.get(port);
    if (existing?.projectId === projectId) {
      this.portLeases.delete(port);
    }
  }

  snapshot(): {
    pool2InUse: number;
    heavyInUse: number;
    portLeases: number;
    slotOwners: string[];
  } {
    return {
      pool2InUse: this.activePool2.length,
      heavyInUse: this.activeHeavy.length,
      portLeases: this.portLeases.size,
      slotOwners: this.activePool2.map((s) => `${s.projectId} ${s.executionRole}`),
    };
  }

  private canGrantImmediately(request: ExecutionSlotRequest): boolean {
    if (this.activePool2.length >= this.limits.pool2WarmSlots) return false;
    if (request.needsHeavyLane && this.activeHeavy.length >= this.limits.heavyLanePermits) {
      return false;
    }
    return true;
  }

  private grantSlot(request: ExecutionSlotRequest): SlotToken {
    if (this.activePool2.length >= this.limits.pool2WarmSlots) {
      throw new MachineCapacityExceededError("pool2");
    }
    if (request.needsHeavyLane && this.activeHeavy.length >= this.limits.heavyLanePermits) {
      throw new MachineCapacityExceededError("heavy_lane");
    }
    const slot: ActiveSlot = {
      requestId: request.requestId,
      projectId: request.projectId,
      executionRole: request.executionRole,
      heavy: request.needsHeavyLane,
    };
    this.activePool2.push(slot);
    if (request.needsHeavyLane) {
      this.activeHeavy.push(slot);
    }
    const tokenId = `slot-${++this.tokenSeq}`;
    return {
      tokenId,
      release: () => this.releaseSlot(slot),
    };
  }

  private releaseSlot(slot: ActiveSlot): void {
    const p2 = this.activePool2.indexOf(slot);
    if (p2 >= 0) this.activePool2.splice(p2, 1);
    const heavy = this.activeHeavy.indexOf(slot);
    if (heavy >= 0) this.activeHeavy.splice(heavy, 1);
    this.pumpWaiters();
  }

  private pumpWaiters(): void {
    const remaining: Waiter[] = [];
    for (const waiter of this.waiters) {
      if (this.canGrantImmediately(waiter)) {
        try {
          waiter.resolve(this.grantSlot(waiter));
        } catch (error) {
          waiter.reject(error instanceof Error ? error : new Error(String(error)));
        }
      } else {
        remaining.push(waiter);
      }
    }
    this.waiters.length = 0;
    this.waiters.push(...remaining);
  }

  private compareWaiters(a: Waiter, b: Waiter): number {
    const rank = ROLE_RANK[a.executionRole] - ROLE_RANK[b.executionRole];
    if (rank !== 0) return rank;
    return a.enqueuedAtMs - b.enqueuedAtMs;
  }
}