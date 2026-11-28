import type { Clock } from "./clock.js";
import { AbortError, CapacityError, assertNonEmpty, assertNonNegativeInt } from "./errors.js";
import {
  THINKING_CPU_WHILE_WAITING,
  THINKING_RAM_MB,
  type ThinkingPermit,
  type ThinkingPhase,
} from "./types.js";

interface ThinkingAgent {
  taskId: string;
  phase: ThinkingPhase;
  admittedAt: number;
}

interface ThinkingWaiter {
  taskId: string;
  settled: boolean;
  resolve: (permit: ThinkingPermit) => void;
  reject: (error: Error) => void;
  detach: () => void;
}

/**
 * Pool 1. Remote thinking stays cheap and wide, and never allocates a warm execution slot.
 */
export class ThinkingPoolCoordinator {
  private readonly agents = new Map<string, ThinkingAgent>();
  private readonly waiters: ThinkingWaiter[] = [];
  private cap: number;

  constructor(
    private readonly clock: Clock,
    cap: number,
  ) {
    assertNonNegativeInt(cap, "thinkingCap");
    this.cap = cap;
  }

  get capacity(): number {
    return this.cap;
  }

  setCapacity(cap: number): void {
    assertNonNegativeInt(cap, "thinkingCap");
    this.cap = cap;
    this.pump();
  }

  occupancy(): number {
    return this.agents.size;
  }

  estimatedRamMb(): number {
    return this.agents.size * THINKING_RAM_MB;
  }

  count(phase: ThinkingPhase): number {
    let total = 0;
    for (const agent of this.agents.values()) {
      if (agent.phase === phase) total += 1;
    }
    return total;
  }

  has(taskId: string): boolean {
    return this.agents.has(taskId);
  }

  phase(taskId: string): ThinkingPhase {
    return this.require(taskId).phase;
  }

  profile(taskId: string): ThinkingPermit {
    const agent = this.require(taskId);
    return {
      taskId: agent.taskId,
      admittedAt: agent.admittedAt,
      ramMb: THINKING_RAM_MB,
      cpuWhileWaiting: THINKING_CPU_WHILE_WAITING,
    };
  }

  admit(taskId: string, signal?: AbortSignal): Promise<ThinkingPermit> {
    assertNonEmpty(taskId, "taskId");
    if (this.agents.has(taskId) || this.waiters.some((waiter) => waiter.taskId === taskId && !waiter.settled)) {
      return Promise.reject(new CapacityError("duplicate_task", `${taskId} is already in the thinking pool`));
    }
    if (signal?.aborted) return Promise.reject(new AbortError());
    if (this.agents.size < this.cap) return Promise.resolve(this.take(taskId));
    return new Promise((resolve, reject) => {
      const waiter: ThinkingWaiter = {
        taskId,
        settled: false,
        resolve,
        reject,
        detach: () => undefined,
      };
      if (signal) {
        const onAbort = () => this.rejectWaiter(waiter, new AbortError());
        signal.addEventListener("abort", onAbort, { once: true });
        waiter.detach = () => signal.removeEventListener("abort", onAbort);
      }
      this.waiters.push(waiter);
    });
  }

  setPhase(taskId: string, phase: ThinkingPhase): void {
    this.require(taskId).phase = phase;
  }

  release(taskId: string): void {
    if (!this.agents.delete(taskId)) {
      throw new CapacityError("unknown_task", `${taskId} has no thinking slot`);
    }
    this.pump();
  }

  private take(taskId: string): ThinkingPermit {
    const agent: ThinkingAgent = {
      taskId,
      phase: "thinking",
      admittedAt: this.clock.now(),
    };
    this.agents.set(taskId, agent);
    return this.profile(taskId);
  }

  private pump(): void {
    while (this.agents.size < this.cap && this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      if (!waiter || waiter.settled) continue;
      waiter.settled = true;
      waiter.detach();
      waiter.resolve(this.take(waiter.taskId));
    }
  }

  private rejectWaiter(waiter: ThinkingWaiter, error: Error): void {
    if (waiter.settled) return;
    waiter.settled = true;
    waiter.detach();
    const index = this.waiters.indexOf(waiter);
    if (index >= 0) this.waiters.splice(index, 1);
    waiter.reject(error);
  }

  private require(taskId: string): ThinkingAgent {
    const agent = this.agents.get(taskId);
    if (!agent) throw new CapacityError("unknown_task", `${taskId} has no thinking slot`);
    return agent;
  }
}
