import type { Clock } from "./clock.js";
import { AbortError, CapacityError, SandboxHoldError, assertNonEmpty, assertPositiveInt } from "./errors.js";
import { compareExecutionPriority } from "./priority.js";
import type { SandboxTierSelectorPort, WindowsJobObjectPort, WorktreeBinding, WorktreeSlotPoolPort } from "./ports.js";
import type { ExecutionSlotBackend } from "./tier-e.js";
import {
  WAITING_FOR_RUN_SLOT,
  type CommandClass,
  type ExecutionLease,
  type ExecutionPoolInspection,
  type ExecutionRequest,
  type LeaseReleaseReason,
  type LeaseRole,
  type ReleaseReport,
  type SandboxTier,
  type WaiterStatus,
} from "./types.js";

interface WarmSlot {
  readonly id: string;
  readonly index: number;
  state: "clean" | "leased" | "dirty";
  ownerTaskId: string | null;
  jobId: string | null;
  leaseId: string | null;
  binding: WorktreeBinding | null;
  backendSlotId: string | null;
}

interface Waiter {
  readonly taskId: string;
  readonly role: LeaseRole;
  readonly commandClass: CommandClass;
  readonly command: string;
  readonly timeoutMs: number;
  readonly criticalPath: boolean;
  readonly attemptId: string;
  readonly enqueuedAt: number;
  readonly seq: number;
  readonly signal: AbortSignal | null;
  settled: boolean;
  detach: () => void;
  onGrant: ((lease: ExecutionLease) => void) | null;
  resolve: (lease: ExecutionLease) => void;
  reject: (error: Error) => void;
}

export interface WarmPoolDependencies {
  readonly clock: Clock;
  readonly warmSlots: number;
  readonly initialTarget: number;
  readonly jobs: WindowsJobObjectPort;
  readonly worktrees: WorktreeSlotPoolPort;
  readonly tiers: SandboxTierSelectorPort;
  readonly backend: ExecutionSlotBackend;
}

/**
 * Pool 2. A small set of warm slots is leased only while a command runs.
 * Priority is verifier, then worker, then background, with worker aging after 60s.
 * The command timeout starts when the lease is granted, never while the task is queued.
 * Pressure changes stop new grants. They do not kill a slot that is already running.
 */
export class WarmExecutionSlotPool {
  private readonly slots: WarmSlot[] = [];
  private readonly waiters: Waiter[] = [];
  private readonly leases = new Map<string, ExecutionLease>();
  private desiredTarget: number;
  private ready = false;
  private pumping = false;
  private nextLease = 1;
  private nextSeq = 1;

  private constructor(private readonly deps: WarmPoolDependencies) {
    assertPositiveInt(deps.warmSlots, "warmSlots");
    if (deps.warmSlots < 2 || deps.warmSlots > 4) {
      throw new CapacityError("invalid_request", "Warm execution inventory must stay between 2 and 4 slots");
    }
    if (!Number.isInteger(deps.initialTarget) || deps.initialTarget < 0) {
      throw new CapacityError("invalid_request", "Execution target must be a non-negative integer");
    }
    this.desiredTarget = deps.initialTarget;
  }

  static async create(deps: WarmPoolDependencies): Promise<WarmExecutionSlotPool> {
    const pool = new WarmExecutionSlotPool(deps);
    await pool.provision();
    return pool;
  }

  get warmSlotCount(): number {
    return this.slots.length;
  }

  runningCount(): number {
    return this.leases.size;
  }

  effectiveTarget(): number {
    return Math.min(this.desiredTarget, this.slots.length);
  }

  setDesiredTarget(target: number): void {
    if (!Number.isInteger(target) || target < 0) {
      throw new CapacityError("invalid_request", "Execution target must be a non-negative integer");
    }
    this.desiredTarget = target;
    this.pump();
  }

  inspect(): ExecutionPoolInspection {
    return {
      desiredTarget: this.desiredTarget,
      effectiveTarget: this.effectiveTarget(),
      warmSlotCount: this.slots.length,
      runningSlotCount: this.leases.size,
      waitingForRunSlotCount: this.waiters.length,
      slotOwnerTaskIds: this.ownerTaskIds(),
      dirtySlotIds: this.slots.filter((slot) => slot.state === "dirty").map((slot) => slot.id),
      waiterStatuses: this.waiterStatuses(),
    };
  }

  ownerTaskIds(): readonly string[] {
    return [...this.leases.values()]
      .sort((left, right) => this.slotIndex(left.slotId) - this.slotIndex(right.slotId))
      .map((lease) => lease.taskId);
  }

  waiterStatuses(): readonly WaiterStatus[] {
    return this.waiters.map((waiter) => ({
      taskId: waiter.taskId,
      status: WAITING_FOR_RUN_SLOT,
    }));
  }

  acquire(
    request: ExecutionRequest,
    hooks?: { readonly onGrant?: (lease: ExecutionLease) => void },
  ): Promise<ExecutionLease> {
    this.assertReady();
    assertNonEmpty(request.taskId, "taskId");
    assertNonEmpty(request.command, "command");
    assertPositiveInt(request.timeoutMs, "timeoutMs");
    if (this.waiters.some((waiter) => waiter.taskId === request.taskId) || this.owns(request.taskId)) {
      return Promise.reject(
        new CapacityError("duplicate_task", `${request.taskId} is already waiting for or holding a run slot`),
      );
    }
    if (request.signal?.aborted) return Promise.reject(new AbortError());
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        taskId: request.taskId,
        role: request.role,
        commandClass: request.commandClass,
        command: request.command,
        timeoutMs: request.timeoutMs,
        criticalPath: request.criticalPath === true,
        attemptId: request.attemptId ?? request.taskId,
        enqueuedAt: this.deps.clock.now(),
        seq: this.nextSeq,
        signal: request.signal ?? null,
        settled: false,
        detach: () => undefined,
        onGrant: hooks?.onGrant ?? null,
        resolve,
        reject,
      };
      this.nextSeq += 1;
      if (request.signal) {
        const onAbort = () => this.rejectWaiter(waiter, new AbortError());
        request.signal.addEventListener("abort", onAbort, { once: true });
        waiter.detach = () => request.signal?.removeEventListener("abort", onAbort);
      }
      this.waiters.push(waiter);
      this.pump();
    });
  }

  release(leaseId: string, reason: LeaseReleaseReason): ReleaseReport {
    this.assertReady();
    const lease = this.leases.get(leaseId);
    if (!lease) throw new CapacityError("unknown_lease", `Unknown execution lease ${leaseId}`);
    const slot = this.slotById(lease.slotId);
    this.deps.jobs.close(lease.jobId);
    const activeChildProcesses = this.deps.jobs.activeChildCount(lease.jobId);
    this.leases.delete(leaseId);
    if (activeChildProcesses === 0) {
      this.markClean(slot);
    } else {
      slot.state = "dirty";
      slot.leaseId = null;
    }
    this.pump();
    return {
      leaseId,
      slotId: slot.id,
      taskId: lease.taskId,
      reason,
      clean: activeChildProcesses === 0,
      activeChildProcesses,
    };
  }

  /** Re-check quarantined slots. A slot is reusable only after the job reports 0 children. */
  auditDirtySlots(): number {
    let reclaimed = 0;
    for (const slot of this.slots) {
      if (slot.state !== "dirty" || !slot.jobId) continue;
      if (this.deps.jobs.activeChildCount(slot.jobId) !== 0) continue;
      this.markClean(slot);
      reclaimed += 1;
    }
    if (reclaimed > 0) this.pump();
    return reclaimed;
  }

  private async provision(): Promise<void> {
    for (let index = 0; index < this.deps.warmSlots; index += 1) {
      const id = `exec-slot-${index + 1}`;
      const provisioned = await this.deps.backend.provisionSlot({
        slotId: id,
        locality: this.deps.backend.locality,
      });
      this.slots.push({
        id,
        index,
        state: "clean",
        ownerTaskId: null,
        jobId: null,
        leaseId: null,
        binding: null,
        backendSlotId: provisioned.backendSlotId,
      });
    }
    this.ready = true;
  }

  private pump(): void {
    if (!this.ready || this.pumping) return;
    this.pumping = true;
    try {
      while (this.leases.size < this.effectiveTarget()) {
        const slot = this.slots.find((item) => item.state === "clean");
        if (!slot) break;
        const waiter = this.pickWaiter();
        if (!waiter) break;
        const decision = this.deps.tiers.selectTier({
          taskId: waiter.taskId,
          commandClass: waiter.commandClass,
          command: waiter.command,
        });
        if (decision.hold || (decision.tier === "UNSANDBOXED" && decision.unsandboxedOverride !== true)) {
          this.rejectWaiter(
            waiter,
            new SandboxHoldError(waiter.taskId, decision.reason ?? "sandbox tier hold"),
          );
          continue;
        }
        this.grant(slot, waiter, decision.tier);
      }
    } finally {
      this.pumping = false;
    }
  }

  private pickWaiter(): Waiter | null {
    const open = this.waiters.filter((waiter) => !waiter.settled);
    if (open.length === 0) return null;
    const now = this.deps.clock.now();
    open.sort((left, right) => compareExecutionPriority(left, right, now));
    return open[0] ?? null;
  }

  private grant(slot: WarmSlot, waiter: Waiter, tier: SandboxTier): void {
    const index = this.waiters.indexOf(waiter);
    if (index >= 0) this.waiters.splice(index, 1);
    const leaseId = `lease-${this.nextLease}`;
    this.nextLease += 1;
    let jobId: string | null = null;
    let binding: WorktreeBinding | null = null;
    let lease: ExecutionLease;
    try {
      jobId = this.deps.jobs.createNestedJob(slot.id, leaseId);
      binding = this.deps.worktrees.bindForCommand({
        taskId: waiter.taskId,
        attemptId: waiter.attemptId,
        executionSlotId: slot.id,
      });
      const acquiredAt = this.deps.clock.now();
      const queuedMs = Math.max(0, acquiredAt - waiter.enqueuedAt);
      lease = {
        leaseId,
        slotId: slot.id,
        taskId: waiter.taskId,
        role: waiter.role,
        commandClass: waiter.commandClass,
        command: waiter.command,
        criticalPath: waiter.criticalPath,
        jobId,
        worktreeSlotId: binding.slotId,
        worktreePath: binding.worktreePath,
        sandboxTier: tier,
        enqueuedAt: waiter.enqueuedAt,
        acquiredAt,
        timeoutMs: waiter.timeoutMs,
        deadlineAt: acquiredAt + waiter.timeoutMs,
        queuedMs,
      };
    } catch (error) {
      if (jobId) this.deps.jobs.close(jobId);
      if (binding) this.deps.worktrees.unbindCommand(binding);
      const wrapped = error instanceof Error ? error : new CapacityError("lease_setup", "Lease setup failed");
      this.rejectWaiter(waiter, wrapped);
      return;
    }
    slot.state = "leased";
    slot.ownerTaskId = waiter.taskId;
    slot.jobId = jobId;
    slot.leaseId = leaseId;
    slot.binding = binding;
    this.leases.set(leaseId, lease);
    waiter.settled = true;
    waiter.detach();
    waiter.onGrant?.(lease);
    waiter.resolve(lease);
  }

  private markClean(slot: WarmSlot): void {
    if (slot.binding) this.deps.worktrees.unbindCommand(slot.binding);
    slot.state = "clean";
    slot.ownerTaskId = null;
    slot.jobId = null;
    slot.leaseId = null;
    slot.binding = null;
  }

  private rejectWaiter(waiter: Waiter, error: Error): void {
    if (waiter.settled) return;
    waiter.settled = true;
    waiter.detach();
    const index = this.waiters.indexOf(waiter);
    if (index >= 0) this.waiters.splice(index, 1);
    waiter.reject(error);
  }

  private owns(taskId: string): boolean {
    for (const lease of this.leases.values()) {
      if (lease.taskId === taskId) return true;
    }
    return false;
  }

  private slotById(slotId: string): WarmSlot {
    const slot = this.slots.find((item) => item.id === slotId);
    if (!slot) throw new CapacityError("unknown_lease", `Unknown execution slot ${slotId}`);
    return slot;
  }

  private slotIndex(slotId: string): number {
    return this.slotById(slotId).index;
  }

  private assertReady(): void {
    if (!this.ready) throw new CapacityError("not_ready", "Warm execution slots are not provisioned yet");
  }
}
