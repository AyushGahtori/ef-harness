import { expect } from "vitest";
import { ManualClock } from "../../src/capacity-pools/clock.js";
import {
  InMemoryIdleSessionParker,
  InMemorySandboxTierSelector,
  InMemoryWindowsJobInspector,
  InMemoryWorktreeSlotPool,
  LocalExecutionSlotBackend,
  ThreePoolCapacityScheduler,
} from "../../src/capacity-pools/index.js";
import type {
  CommandClass,
  ExecutionRequest,
  LeaseRole,
} from "../../src/capacity-pools/index.js";

export interface Harness {
  readonly clock: ManualClock;
  readonly jobs: InMemoryWindowsJobInspector;
  readonly worktrees: InMemoryWorktreeSlotPool;
  readonly tiers: InMemorySandboxTierSelector;
  readonly parker: InMemoryIdleSessionParker;
  readonly backend: LocalExecutionSlotBackend;
  readonly scheduler: ThreePoolCapacityScheduler;
}

export async function createHarness(
  options: {
    readonly totalRamGb?: number;
    readonly diskFreeGb?: number;
    readonly pressure?: string;
    readonly thinkingCap?: number;
    readonly executionCap?: number;
    readonly sessionProcessCap?: number;
    readonly providerPacingCap?: number;
    readonly dagDisjointWidth?: number;
  } = {},
): Promise<Harness> {
  const clock = new ManualClock();
  const jobs = new InMemoryWindowsJobInspector();
  const worktrees = new InMemoryWorktreeSlotPool();
  const tiers = new InMemorySandboxTierSelector();
  const parker = new InMemoryIdleSessionParker();
  const backend = new LocalExecutionSlotBackend();
  const scheduler = await ThreePoolCapacityScheduler.create({
    totalRamGb: options.totalRamGb ?? 16,
    diskFreeGb: options.diskFreeGb ?? 64,
    clock,
    jobs,
    worktrees,
    tiers,
    parker,
    backend,
    ...(options.pressure ? { pressure: options.pressure } : {}),
    ...(options.thinkingCap !== undefined ? { thinkingCap: options.thinkingCap } : {}),
    ...(options.executionCap !== undefined ? { executionCap: options.executionCap } : {}),
    ...(options.sessionProcessCap !== undefined ? { sessionProcessCap: options.sessionProcessCap } : {}),
    ...(options.providerPacingCap !== undefined ? { providerPacingCap: options.providerPacingCap } : {}),
    ...(options.dagDisjointWidth !== undefined ? { dagDisjointWidth: options.dagDisjointWidth } : {}),
  });
  return { clock, jobs, worktrees, tiers, parker, backend, scheduler };
}

export function runRequest(input: {
  readonly taskId: string;
  readonly role?: LeaseRole;
  readonly commandClass?: CommandClass;
  readonly command?: string;
  readonly timeoutMs?: number;
  readonly criticalPath?: boolean;
  readonly signal?: AbortSignal;
}): ExecutionRequest {
  const request: {
    taskId: string;
    role: LeaseRole;
    commandClass: CommandClass;
    command: string;
    timeoutMs: number;
    criticalPath?: boolean;
    signal?: AbortSignal;
  } = {
    taskId: input.taskId,
    role: input.role ?? "worker",
    commandClass: input.commandClass ?? "pnpm_test",
    command: input.command ?? "pnpm test",
    timeoutMs: input.timeoutMs ?? 5_000,
  };
  if (input.criticalPath === true) request.criticalPath = true;
  if (input.signal) request.signal = input.signal;
  return request;
}

export async function admit(scheduler: ThreePoolCapacityScheduler, taskIds: readonly string[]): Promise<void> {
  for (const taskId of taskIds) {
    await scheduler.admitThinking(taskId);
  }
}

export function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: ((value: T) => void) | null = null;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  if (!resolve) throw new Error("deferred resolve was not installed");
  return { promise, resolve };
}

export async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  expect(predicate()).toBe(true);
}
