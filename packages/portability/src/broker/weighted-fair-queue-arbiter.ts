import type { BrokerRequest, PriorityClass, WfqServiceSample } from "./types.js";
import { PRIORITY_CLASS_WEIGHTS } from "./types.js";

const QUEUE_ORDER: readonly PriorityClass[] = ["interactive", "foreground", "background", "batch"];

interface QueuedRequest extends BrokerRequest {
  virtualFinish: number;
}

function toBrokerRequest(item: QueuedRequest): BrokerRequest {
  const base: BrokerRequest = {
    requestId: item.requestId,
    projectId: item.projectId,
    priorityClass: item.priorityClass,
    enqueuedAtMs: item.enqueuedAtMs,
  };
  const withConnection =
    item.connectionId !== undefined ? { ...base, connectionId: item.connectionId } : base;
  if (item.role !== undefined) {
    return { ...withConnection, role: item.role };
  }
  return withConnection;
}

/**
 * Deficit weighted fair queuing across the four canonical operational classes.
 * interactive:8 > foreground:4 > background:2 > batch:1 with zero starvation.
 */
export class WeightedFairQueueArbiter {
  private readonly queues = new Map<PriorityClass, QueuedRequest[]>();
  private readonly deficits = new Map<PriorityClass, number>();
  private readonly quantum = 1;
  private lastInteractiveDispatchMs = 0;

  constructor() {
    for (const cls of QUEUE_ORDER) {
      this.queues.set(cls, []);
      this.deficits.set(cls, 0);
    }
  }

  enqueue(request: BrokerRequest): void {
    const queue = this.queues.get(request.priorityClass);
    if (!queue) return;
    const virtualFinish = this.nextVirtualFinish(request.priorityClass);
    queue.push({ ...request, virtualFinish });
  }

  dequeueNext(nowMs: number): BrokerRequest | undefined {
    const pick = this.pickQueue();
    if (!pick) return undefined;
    const queue = this.queues.get(pick)!;
    const item = queue.shift();
    if (!item) return undefined;
    const deficit = this.deficits.get(pick) ?? 0;
    this.deficits.set(pick, deficit - this.quantum);
    if (item.priorityClass === "interactive") {
      this.lastInteractiveDispatchMs = nowMs;
    }
    return toBrokerRequest(item);
  }

  /**
   * Reserved interactive fast lane: immediate when the interactive queue is non-empty
   * and no other interactive work is ahead of this request.
   */
  tryDispatchInteractiveFastLane(nowMs: number): BrokerRequest | undefined {
    const queue = this.queues.get("interactive") ?? [];
    if (queue.length === 0) return undefined;
    const item = queue.shift()!;
    this.lastInteractiveDispatchMs = nowMs;
    return toBrokerRequest(item);
  }

  interactiveQueueWaitMs(nowMs: number): number {
    const queue = this.queues.get("interactive") ?? [];
    if (queue.length === 0) return 0;
    if (this.lastInteractiveDispatchMs === 0) return 0;
    return Math.max(0, nowMs - this.lastInteractiveDispatchMs);
  }

  queueDepth(priorityClass: PriorityClass): number {
    return this.queues.get(priorityClass)?.length ?? 0;
  }

  simulateService(rounds: number): WfqServiceSample[] {
    const counts = new Map<PriorityClass, number>();
    for (const cls of QUEUE_ORDER) counts.set(cls, 0);
    for (let i = 0; i < rounds; i += 1) {
      const pick = this.pickQueue();
      if (!pick) break;
      counts.set(pick, (counts.get(pick) ?? 0) + 1);
      const deficit = this.deficits.get(pick) ?? 0;
      this.deficits.set(pick, deficit - this.quantum);
    }
    return QUEUE_ORDER.map((priorityClass) => ({
      priorityClass,
      dispatches: counts.get(priorityClass) ?? 0,
    }));
  }

  private pickQueue(): PriorityClass | undefined {
    for (const cls of QUEUE_ORDER) {
      const deficit = (this.deficits.get(cls) ?? 0) + PRIORITY_CLASS_WEIGHTS[cls] * this.quantum;
      this.deficits.set(cls, deficit);
    }
    let best: PriorityClass | undefined;
    let bestDeficit = Number.NEGATIVE_INFINITY;
    for (const cls of QUEUE_ORDER) {
      const depth = this.queues.get(cls)?.length ?? 0;
      if (depth === 0) continue;
      const deficit = this.deficits.get(cls) ?? 0;
      if (deficit > bestDeficit) {
        bestDeficit = deficit;
        best = cls;
      }
    }
    return best;
  }

  private nextVirtualFinish(priorityClass: PriorityClass): number {
    const queue = this.queues.get(priorityClass) ?? [];
    const weight = PRIORITY_CLASS_WEIGHTS[priorityClass];
    const last = queue.length > 0 ? queue[queue.length - 1]!.virtualFinish : 0;
    return last + 1 / weight;
  }
}

export function wfqWeight(priorityClass: PriorityClass): number {
  return PRIORITY_CLASS_WEIGHTS[priorityClass];
}