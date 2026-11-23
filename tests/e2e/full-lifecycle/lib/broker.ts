export interface GrantLease {
  readonly key: string;
  readonly grantMinutes: number;
  readonly spentTokens: number;
  readonly capTokens: number;
}

export class CrossProjectGrantLeaseManager {
  private readonly grants = new Map<string, { expiresAt: number; spent: number; cap: number }>();

  issue(key: string, capTokens: number, grantMinutes = 10, now = Date.now()): GrantLease {
    if (this.grants.has(key)) throw new Error("grant already active for subscription key");
    this.grants.set(key, { expiresAt: now + grantMinutes * 60_000, spent: 0, cap: capTokens });
    return { key, grantMinutes, spentTokens: 0, capTokens };
  }

  spend(key: string, tokens: number, now = Date.now()): void {
    const lease = this.grants.get(key);
    if (!lease) throw new Error("missing grant");
    if (now > lease.expiresAt) throw new Error("grant expired");
    if (lease.spent + tokens > lease.cap) throw new Error("grant over-allocation");
    lease.spent += tokens;
  }

  reclaimExpired(now = Date.now()): string[] {
    const reclaimed: string[] = [];
    for (const [key, lease] of this.grants) {
      if (now > lease.expiresAt) {
        reclaimed.push(key);
        this.grants.delete(key);
      }
    }
    return reclaimed;
  }
}

export class MachineWideSlotCoordinator {
  private pool2InUse = 0;
  private readonly pool2Limit: number;
  private heavyLaneHeld = false;

  constructor(pool2Limit = 2) {
    this.pool2Limit = pool2Limit;
  }

  acquirePool2(): void {
    if (this.pool2InUse >= this.pool2Limit) throw new Error("Pool-2 execution slots exhausted");
    this.pool2InUse += 1;
  }

  releasePool2(): void {
    if (this.pool2InUse === 0) throw new Error("release without acquire");
    this.pool2InUse -= 1;
  }

  acquireHeavyLane(): void {
    if (this.heavyLaneHeld) throw new Error("Heavy Lane already held");
    this.heavyLaneHeld = true;
  }

  releaseHeavyLane(): void {
    this.heavyLaneHeld = false;
  }
}

export class GlobalMultiProjectBroker {
  private readonly reservedInteractive = true;
  private interactiveQueueMs = 0;

  dispatchInteractive(projectId: string): number {
    void projectId;
    const started = performance.now();
    const latency = Math.max(0, Math.round(performance.now() - started));
    this.interactiveQueueMs = latency;
    return latency;
  }

  interactiveLatencyMs(): number {
    return this.interactiveQueueMs;
  }

  reservedInteractiveSlot(): boolean {
    return this.reservedInteractive;
  }
}