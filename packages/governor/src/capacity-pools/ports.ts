import { CapacityError, assertNonEmpty } from "./errors.js";
import { canonicalGovernorPressure, type CommandClass, type GovernorPressure, type LeaseRole, type SandboxTier } from "./types.js";

/**
 * Local stand-in for Task 038 `WorktreeSlotPool` (`acquireSlot` / `releaseSlot`).
 * Command binding does not recycle the attempt worktree. The integrator maps
 * `bindForCommand` onto the attempt's already acquired slot.
 */
export interface WorktreeBinding {
  readonly slotId: string;
  readonly worktreePath: string;
  readonly taskId: string;
  readonly executionSlotId: string;
}

export interface WorktreeSlotPoolPort {
  bindForCommand(request: {
    readonly taskId: string;
    readonly attemptId: string;
    readonly executionSlotId: string;
  }): WorktreeBinding;
  unbindCommand(binding: WorktreeBinding): void;
}

export interface SandboxTierSelection {
  readonly tier: SandboxTier;
  readonly hold: boolean;
  readonly reason?: string;
  readonly unsandboxedOverride?: boolean;
}

/** Local stand-in for `SandboxTierSelector` (Task 043; Task 119 names Task 045). */
export interface SandboxTierSelectorPort {
  selectTier(request: {
    readonly taskId: string;
    readonly commandClass: CommandClass;
    readonly command: string;
  }): SandboxTierSelection;
}

/**
 * Local stand-in for Task 107 `WaveParallelismCalculator`.
 * `W_eff = min(dag, hardware, pacing, worktree, preset)`.
 */
export interface WaveParallelismInput {
  readonly dagDisjointWidth: number;
  readonly hardwarePoolCap: number;
  readonly providerPacingCap: number;
  readonly worktreeSlotCap: number;
  readonly userPresetCap: number;
}

export interface WaveParallelismCalculatorPort {
  effectiveConcurrency(input: WaveParallelismInput): number;
}

/** Local stand-in for Task 118 `PressureHysteresisStateMachine`. */
export interface PressureHysteresisPort {
  current(): GovernorPressure;
}

export interface HeavyLanePermit {
  readonly permitId: string;
  readonly taskId: string;
  readonly role: LeaseRole;
}

/** Local stand-in for Task 118 `HeavyLaneSemaphore`. */
export interface HeavyLaneSemaphorePort {
  maxPermits(): number;
  tryAcquire(request: {
    readonly taskId: string;
    readonly role: LeaseRole;
    readonly commandClass: CommandClass;
  }): HeavyLanePermit | null;
  acquire(request: {
    readonly taskId: string;
    readonly role: LeaseRole;
    readonly commandClass: CommandClass;
  }): Promise<HeavyLanePermit>;
  release(permitId: string): void;
}

/** Local stand-in for Task 041 nested Windows Job Objects. */
export interface WindowsJobObjectPort {
  createNestedJob(slotId: string, leaseId: string): string;
  activeChildCount(jobId: string): number;
  close(jobId: string): void;
}

export interface ParkRequest {
  readonly sessionId: string;
  readonly runtime: string;
  readonly residentRamMb: number;
  readonly idleMs: number;
  readonly reason: "session_process_cap";
}

export interface ParkResult {
  readonly parked: true;
  readonly reclaimedRamMb: number;
}

/** Local stand-in for Task 150 `IdleWrappedAgentAutoParker`. */
export interface IdleWrappedAgentParkerPort {
  checkpointAndPark(request: ParkRequest): ParkResult;
}

export class InMemoryWorktreeSlotPool implements WorktreeSlotPoolPort {
  readonly bindings: WorktreeBinding[] = [];
  bindCount = 0;
  unbindCount = 0;

  bindForCommand(request: {
    readonly taskId: string;
    readonly attemptId: string;
    readonly executionSlotId: string;
  }): WorktreeBinding {
    assertNonEmpty(request.taskId, "taskId");
    const binding: WorktreeBinding = {
      slotId: `wt-${request.attemptId}`,
      worktreePath: `wt/${request.attemptId}`,
      taskId: request.taskId,
      executionSlotId: request.executionSlotId,
    };
    this.bindings.push(binding);
    this.bindCount += 1;
    return binding;
  }

  unbindCommand(binding: WorktreeBinding): void {
    const index = this.bindings.findIndex(
      (item) => item.slotId === binding.slotId && item.executionSlotId === binding.executionSlotId,
    );
    if (index >= 0) this.bindings.splice(index, 1);
    this.unbindCount += 1;
  }
}

export class InMemorySandboxTierSelector implements SandboxTierSelectorPort {
  readonly holdCommands = new Set<CommandClass>();
  holdReason = "sandbox_tier_insufficient";

  selectTier(request: {
    readonly taskId: string;
    readonly commandClass: CommandClass;
    readonly command: string;
  }): SandboxTierSelection {
    if (this.holdCommands.has(request.commandClass)) {
      return { tier: "C", hold: true, reason: this.holdReason };
    }
    return { tier: "A", hold: false };
  }
}

export class LocalWaveParallelismCalculator implements WaveParallelismCalculatorPort {
  effectiveConcurrency(input: WaveParallelismInput): number {
    const values = [
      input.dagDisjointWidth,
      input.hardwarePoolCap,
      input.providerPacingCap,
      input.worktreeSlotCap,
      input.userPresetCap,
    ];
    let min = Number.POSITIVE_INFINITY;
    for (const value of values) {
      if (!Number.isFinite(value)) {
        throw new CapacityError("parallelism", "Concurrency inputs must be finite");
      }
      if (!Number.isInteger(value) || value < 0) {
        throw new CapacityError("parallelism", "Concurrency inputs must be non-negative integers");
      }
      if (value < min) min = value;
    }
    return min;
  }
}

export class InMemoryPressureSource implements PressureHysteresisPort {
  private level: GovernorPressure;

  constructor(level: string = "GREEN") {
    this.level = canonicalGovernorPressure(level);
  }

  current(): GovernorPressure {
    return this.level;
  }

  set(level: string): void {
    this.level = canonicalGovernorPressure(level);
  }
}

const HEAVY_ROLE_RANK: Record<LeaseRole, number> = {
  verifier: 3,
  worker: 2,
  background: 1,
};

export class InMemoryHeavyLaneSemaphore implements HeavyLaneSemaphorePort {
  private readonly permits: HeavyLanePermit[] = [];
  private readonly waiters: Array<{
    readonly request: { taskId: string; role: LeaseRole; commandClass: CommandClass };
    readonly resolve: (permit: HeavyLanePermit) => void;
    readonly seq: number;
  }> = [];
  private nextId = 1;
  private seq = 0;

  private max: number;

  constructor(max: number) {
    if (!Number.isInteger(max) || max < 0) {
      throw new CapacityError("heavy_lane", "Heavy-lane permits must be a non-negative integer");
    }
    this.max = max;
  }

  /** Lowering the cap does not cancel a permit that is already held. */
  setMaxPermits(max: number): void {
    if (!Number.isInteger(max) || max < 0) {
      throw new CapacityError("heavy_lane", "Heavy-lane permits must be a non-negative integer");
    }
    this.max = max;
    this.pump();
  }

  maxPermits(): number {
    return this.max;
  }

  activeCount(): number {
    return this.permits.length;
  }

  tryAcquire(request: {
    readonly taskId: string;
    readonly role: LeaseRole;
    readonly commandClass: CommandClass;
  }): HeavyLanePermit | null {
    if (this.permits.length >= this.max) return null;
    const permit: HeavyLanePermit = {
      permitId: `heavy-${this.nextId}`,
      taskId: request.taskId,
      role: request.role,
    };
    this.nextId += 1;
    this.permits.push(permit);
    return permit;
  }

  acquire(request: {
    readonly taskId: string;
    readonly role: LeaseRole;
    readonly commandClass: CommandClass;
  }): Promise<HeavyLanePermit> {
    const immediate = this.tryAcquire(request);
    if (immediate) return Promise.resolve(immediate);
    return new Promise((resolve) => {
      this.waiters.push({ request, resolve, seq: this.seq });
      this.seq += 1;
    });
  }

  release(permitId: string): void {
    const index = this.permits.findIndex((permit) => permit.permitId === permitId);
    if (index < 0) {
      throw new CapacityError("heavy_lane", `Unknown heavy-lane permit ${permitId}`);
    }
    this.permits.splice(index, 1);
    this.pump();
  }

  private pump(): void {
    while (this.permits.length < this.max && this.waiters.length > 0) {
      this.waiters.sort((left, right) => {
        const gap = HEAVY_ROLE_RANK[right.request.role] - HEAVY_ROLE_RANK[left.request.role];
        if (gap !== 0) return gap;
        return left.seq - right.seq;
      });
      const next = this.waiters.shift();
      if (!next) break;
      const permit = this.tryAcquire(next.request);
      if (!permit) {
        this.waiters.unshift(next);
        break;
      }
      next.resolve(permit);
    }
  }
}

interface JobRecord {
  children: number;
  closed: boolean;
}

export class InMemoryWindowsJobInspector implements WindowsJobObjectPort {
  private readonly jobs = new Map<string, JobRecord>();
  private nextId = 1;
  /** When set, close() leaves child processes so the slot fails the cleanliness check. */
  retainChildrenOnClose = false;

  createNestedJob(slotId: string, leaseId: string): string {
    assertNonEmpty(slotId, "slotId");
    assertNonEmpty(leaseId, "leaseId");
    const jobId = `job-${this.nextId}`;
    this.nextId += 1;
    this.jobs.set(jobId, { children: this.retainChildrenOnClose ? 2 : 0, closed: false });
    return jobId;
  }

  activeChildCount(jobId: string): number {
    return this.require(jobId).children;
  }

  close(jobId: string): void {
    const job = this.require(jobId);
    job.closed = true;
    if (!this.retainChildrenOnClose) job.children = 0;
  }

  clearChildren(jobId: string): void {
    this.require(jobId).children = 0;
  }

  private require(jobId: string): JobRecord {
    const job = this.jobs.get(jobId);
    if (!job) throw new CapacityError("job", `Unknown job ${jobId}`);
    return job;
  }
}

export class InMemoryIdleSessionParker implements IdleWrappedAgentParkerPort {
  readonly parked: ParkRequest[] = [];

  checkpointAndPark(request: ParkRequest): ParkResult {
    this.parked.push(request);
    return { parked: true, reclaimedRamMb: request.residentRamMb };
  }
}

export function heavyLanePermitsFor(totalRamGb: number, pressure: string): number {
  const canonical = canonicalGovernorPressure(pressure);
  if (totalRamGb <= 16 || canonical === "YELLOW" || canonical === "ORANGE" || canonical === "RED") {
    return 1;
  }
  return 2;
}
