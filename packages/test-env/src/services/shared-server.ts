import type { Clock, TimeoutHandle } from "./clock.js";

interface PoolEntry<T> {
  refs: number;
  runtime: T | null;
  starting: Promise<T> | null;
  idle: TimeoutHandle | null;
  degradedStderr: string | null;
  generation: number;
}

export interface AcquiredServer<T> {
  readonly runtime: T;
  readonly restarted: boolean;
}

/**
 * Lazy shared project server. The first environment starts it. The last
 * environment schedules shutdown after the idle grace period. Project close
 * stops it immediately.
 */
export class ProjectSharedServerPool<T> {
  private readonly entries = new Map<string, PoolEntry<T>>();

  constructor(
    private readonly options: {
      readonly idleGraceMs: number;
      readonly clock: Clock;
      readonly start: (key: string) => Promise<T>;
      readonly stop: (key: string, runtime: T) => Promise<void>;
    },
  ) {}

  async acquire(key: string): Promise<AcquiredServer<T>> {
    const entry = this.ensure(key);
    this.cancelIdle(entry);
    if (entry.starting) {
      const runtime = await entry.starting;
      entry.refs += 1;
      return { runtime, restarted: false };
    }
    if (entry.runtime && entry.degradedStderr === null) {
      entry.refs += 1;
      return { runtime: entry.runtime, restarted: false };
    }
    const restarted = entry.degradedStderr !== null || entry.runtime !== null;
    const previous = entry.runtime;
    entry.runtime = null;
    entry.degradedStderr = null;
    const generation = entry.generation + 1;
    entry.generation = generation;
    let settle: (value: T) => void = () => undefined;
    let fail: (error: unknown) => void = () => undefined;
    const gate = new Promise<T>((resolve, reject) => {
      settle = resolve;
      fail = reject;
    });
    gate.catch(() => undefined);
    entry.starting = gate;
    try {
      if (previous) await this.options.stop(key, previous);
      const runtime = await this.options.start(key);
      if (entry.generation !== generation) {
        await this.options.stop(key, runtime);
        throw new Error(`shared server ${key} start was cancelled`);
      }
      entry.runtime = runtime;
      settle(runtime);
      entry.refs += 1;
      return { runtime, restarted };
    } catch (error) {
      fail(error);
      throw error;
    } finally {
      if (entry.starting === gate) entry.starting = null;
    }
  }

  async release(key: string): Promise<void> {
    const entry = this.entries.get(key);
    if (!entry || entry.refs <= 0) return;
    entry.refs -= 1;
    if (entry.refs > 0) return;
    const runtime = entry.runtime;
    if (!runtime) return;
    const generation = entry.generation;
    const stop = async (): Promise<void> => {
      if (entry.refs > 0) return;
      if (entry.runtime !== runtime) return;
      if (entry.generation !== generation) return;
      entry.runtime = null;
      await this.options.stop(key, runtime);
    };
    if (this.options.idleGraceMs <= 0) {
      await stop();
      return;
    }
    entry.idle = this.options.clock.setTimeout(() => stop(), this.options.idleGraceMs);
  }

  async close(key: string): Promise<void> {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.cancelIdle(entry);
    entry.refs = 0;
    entry.generation += 1;
    const runtime = entry.runtime;
    entry.runtime = null;
    entry.degradedStderr = null;
    this.entries.delete(key);
    if (runtime) await this.options.stop(key, runtime);
  }

  async closeAll(): Promise<void> {
    const keys = [...this.entries.keys()];
    for (const key of keys) {
      await this.close(key);
    }
  }

  notifyUnexpectedExit(key: string, stderr: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.degradedStderr = stderr;
    entry.runtime = null;
  }

  runtimeOf(key: string): T | null {
    return this.entries.get(key)?.runtime ?? null;
  }

  refs(key: string): number {
    return this.entries.get(key)?.refs ?? 0;
  }

  private ensure(key: string): PoolEntry<T> {
    const existing = this.entries.get(key);
    if (existing) return existing;
    const created: PoolEntry<T> = {
      refs: 0,
      runtime: null,
      starting: null,
      idle: null,
      degradedStderr: null,
      generation: 0,
    };
    this.entries.set(key, created);
    return created;
  }

  private cancelIdle(entry: PoolEntry<T>): void {
    if (!entry.idle) return;
    entry.idle.cancel();
    entry.idle = null;
  }
}
