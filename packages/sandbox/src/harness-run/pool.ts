import { randomBytes } from "node:crypto";
import type { ExecutionMode, ExecutionSlot, RunPriority, SandboxTier, SandboxTierSelector } from "./types.js";

const PRIORITY_RANK: Record<RunPriority, number> = {
  verifier: 0,
  worker: 1,
  background: 2,
};

interface Waiter {
  readonly priority: number;
  readonly attemptId: string;
  readonly seq: number;
  readonly resolve: (slot: ExecutionSlot) => void;
}

export class WarmExecutionPool implements SandboxTierSelector {
  private readonly size: number;
  private readonly tier: SandboxTier;
  private readonly mode: ExecutionMode;
  private available: number;
  private seq = 0;
  private readonly queue: Waiter[] = [];
  private readonly inUseByAttempt = new Map<string, number>();
  private closed = false;

  constructor(options: { readonly size?: number; readonly tier?: SandboxTier; readonly mode?: ExecutionMode } = {}) {
    this.size = options.size ?? 2;
    this.tier = options.tier ?? "C";
    this.mode = options.mode ?? "own_loop";
    this.available = this.size;
  }

  acquire(request: { readonly priority: RunPriority; readonly attemptId: string }): Promise<ExecutionSlot> {
    if (this.closed) {
      return Promise.reject(new Error("execution pool is closed"));
    }
    if (this.available > 0 && this.queue.length === 0) {
      this.available -= 1;
      return Promise.resolve(this.makeSlot(request.attemptId));
    }
    return new Promise((resolve) => {
      this.queue.push({
        priority: PRIORITY_RANK[request.priority],
        attemptId: request.attemptId,
        seq: this.seq,
        resolve,
      });
      this.seq += 1;
      this.pump();
    });
  }

  close(): void {
    this.closed = true;
  }

  private pump(): void {
    while (this.available > 0 && this.queue.length > 0) {
      const index = this.pickIndex();
      const waiter = this.queue[index];
      if (waiter === undefined) return;
      this.queue.splice(index, 1);
      this.available -= 1;
      waiter.resolve(this.makeSlot(waiter.attemptId));
    }
  }

  private pickIndex(): number {
    let best = 0;
    for (let index = 1; index < this.queue.length; index += 1) {
      const candidate = this.queue[index];
      const current = this.queue[best];
      if (candidate === undefined || current === undefined) continue;
      const candidateUse = this.inUseByAttempt.get(candidate.attemptId) ?? 0;
      const currentUse = this.inUseByAttempt.get(current.attemptId) ?? 0;
      if (candidate.priority < current.priority) {
        best = index;
      } else if (candidate.priority === current.priority) {
        if (candidateUse < currentUse || (candidateUse === currentUse && candidate.seq < current.seq)) {
          best = index;
        }
      }
    }
    return best;
  }

  private makeSlot(attemptId: string): ExecutionSlot {
    this.inUseByAttempt.set(attemptId, (this.inUseByAttempt.get(attemptId) ?? 0) + 1);
    let released = false;
    return {
      slotId: randomBytes(8).toString("hex"),
      tier: this.tier,
      mode: this.mode,
      nodeModulesReadOnly: true,
      release: () => {
        if (released) return;
        released = true;
        const remaining = (this.inUseByAttempt.get(attemptId) ?? 1) - 1;
        if (remaining <= 0) this.inUseByAttempt.delete(attemptId);
        else this.inUseByAttempt.set(attemptId, remaining);
        this.available += 1;
        this.pump();
      },
    };
  }
}
