import type { Clock } from "./clock.js";
import { systemClock } from "./clock.js";
import { executionTargetFor, ramClassDefaults } from "./defaults.js";
import { AbortError, CapacityError, ExecutionTimeoutError, assertNonNegativeInt, assertPositiveInt } from "./errors.js";
import {
  InMemoryHeavyLaneSemaphore,
  InMemoryIdleSessionParker,
  InMemorySandboxTierSelector,
  InMemoryWindowsJobInspector,
  InMemoryWorktreeSlotPool,
  LocalWaveParallelismCalculator,
  heavyLanePermitsFor,
  type HeavyLanePermit,
  type HeavyLaneSemaphorePort,
  type IdleWrappedAgentParkerPort,
  type PressureHysteresisPort,
  type SandboxTierSelectorPort,
  type WaveParallelismCalculatorPort,
  type WindowsJobObjectPort,
  type WorktreeSlotPoolPort,
} from "./ports.js";
import {
  SessionProcessCapGuard,
  type ParkedForeignSession,
  type ResidentForeignSession,
  type SpawnForeignSessionRequest,
} from "./session-process-cap.js";
import { SingleDiskWriteLane } from "./disk-write-lane.js";
import { ThinkingPoolCoordinator } from "./thinking-pool.js";
import {
  LocalExecutionSlotBackend,
  TierERemoteExecutionInterface,
  type ExecutionSlotBackend,
} from "./tier-e.js";
import {
  type CapacitySnapshot,
  type DiskWriteKind,
  type ExecutionLease,
  type ExecutionRequest,
  type GovernorPressure,
  type LeaseReleaseReason,
  type ReleaseReport,
  isGovernorPressure,
  isHeavyCommand,
} from "./types.js";
import { WarmExecutionSlotPool } from "./warm-execution-pool.js";

export interface ThreePoolSchedulerOptions {
  readonly totalRamGb: number;
  readonly clock?: Clock;
  readonly diskFreeGb?: number;
  readonly pressure?: GovernorPressure;
  /** Overrides the RAM-class thinking width. Still bounded by pacing and DAG width. */
  readonly thinkingCap?: number;
  /** Overrides the RAM-class warm inventory. Must stay inside 2–4. */
  readonly executionCap?: number;
  readonly sessionProcessCap?: number;
  readonly providerPacingCap?: number;
  readonly dagDisjointWidth?: number;
  readonly worktrees?: WorktreeSlotPoolPort;
  readonly tiers?: SandboxTierSelectorPort;
  readonly parallelism?: WaveParallelismCalculatorPort;
  readonly pressureSource?: PressureHysteresisPort;
  readonly heavyLane?: HeavyLaneSemaphorePort;
  readonly jobs?: WindowsJobObjectPort;
  readonly parker?: IdleWrappedAgentParkerPort;
  readonly backend?: ExecutionSlotBackend;
  /** v1 stays local unless a test or a post-v1 host opts in. */
  readonly allowRemoteBackend?: boolean;
}

const UNBOUNDED = Number.MAX_SAFE_INTEGER;

/**
 * Owns the three pools, the disk lane, and the Tier E backend seam.
 * Thinking width is not tied to the warm execution width.
 */
export class ThreePoolCapacityScheduler {
  readonly thinking: ThinkingPoolCoordinator;
  readonly execution: WarmExecutionSlotPool;
  readonly sessions: SessionProcessCapGuard;
  readonly disk: SingleDiskWriteLane;
  readonly tierE: TierERemoteExecutionInterface;
  readonly totalRamGb: number;
  readonly warmExecutionCap: number;

  private readonly clock: Clock;
  private readonly parallelism: WaveParallelismCalculatorPort;
  private readonly heavyLane: HeavyLaneSemaphorePort;
  private readonly ownedHeavyLane: InMemoryHeavyLaneSemaphore | null;
  private readonly ramThinkingCap: number;
  private pressure: GovernorPressure;
  private diskFreeGb: number;
  private providerPacingCap: number;
  private dagDisjointWidth: number;

  private constructor(
    options: ThreePoolSchedulerOptions,
    execution: WarmExecutionSlotPool,
    backend: ExecutionSlotBackend,
  ) {
    const defaults = ramClassDefaults(options.totalRamGb);
    this.totalRamGb = defaults.totalRamGb;
    this.clock = options.clock ?? systemClock;
    this.pressure = options.pressure ?? "Green";
    if (!isGovernorPressure(this.pressure)) {
      throw new CapacityError("invalid_request", "Unknown governor pressure");
    }
    this.diskFreeGb = options.diskFreeGb ?? 64;
    if (!Number.isFinite(this.diskFreeGb) || this.diskFreeGb < 0) {
      throw new CapacityError("invalid_request", "diskFreeGb must be a non-negative finite number");
    }
    this.warmExecutionCap = options.executionCap ?? defaults.executionCap;
    if (this.warmExecutionCap < 2 || this.warmExecutionCap > 4) {
      throw new CapacityError("invalid_request", "Warm execution inventory must stay between 2 and 4 slots");
    }
    this.ramThinkingCap = options.thinkingCap ?? defaults.thinkingCap;
    if (this.ramThinkingCap < 1 || this.ramThinkingCap > 20) {
      throw new CapacityError("invalid_request", "Thinking cap must stay inside 1–20");
    }
    this.providerPacingCap = options.providerPacingCap ?? UNBOUNDED;
    this.dagDisjointWidth = options.dagDisjointWidth ?? UNBOUNDED;
    assertNonNegativeInt(this.providerPacingCap, "providerPacingCap");
    assertNonNegativeInt(this.dagDisjointWidth, "dagDisjointWidth");
    const sessionCap = options.sessionProcessCap ?? defaults.sessionProcessCap;
    assertPositiveInt(sessionCap, "sessionProcessCap");

    if (backend.locality === "remote" && options.allowRemoteBackend !== true) {
      throw new CapacityError(
        "tier_e",
        "v1 keeps Pool 2 on the local execution backend. Pass allowRemoteBackend to plug in Tier E.",
      );
    }
    this.tierE = new TierERemoteExecutionInterface(backend);
    this.parallelism = options.parallelism ?? new LocalWaveParallelismCalculator();
    this.thinking = new ThinkingPoolCoordinator(this.clock, this.ramThinkingCap);
    this.execution = execution;
    this.sessions = new SessionProcessCapGuard(
      this.clock,
      sessionCap,
      options.parker ?? new InMemoryIdleSessionParker(),
    );
    this.disk = new SingleDiskWriteLane();
    if (options.heavyLane) {
      this.ownedHeavyLane = null;
      this.heavyLane = options.heavyLane;
    } else {
      const owned = new InMemoryHeavyLaneSemaphore(heavyLanePermitsFor(this.totalRamGb, this.pressure));
      this.ownedHeavyLane = owned;
      this.heavyLane = owned;
    }
    this.applyThinkingCap();
    this.recomputeTarget();
  }

  static async create(options: ThreePoolSchedulerOptions): Promise<ThreePoolCapacityScheduler> {
    const defaults = ramClassDefaults(options.totalRamGb);
    const clock = options.clock ?? systemClock;
    const pressure = options.pressure ?? "Green";
    const diskFreeGb = options.diskFreeGb ?? 64;
    const warm = options.executionCap ?? defaults.executionCap;
    const backend = options.backend ?? new LocalExecutionSlotBackend();
    const execution = await WarmExecutionSlotPool.create({
      clock,
      warmSlots: warm,
      initialTarget: executionTargetFor({ warmSlots: warm, pressure, diskFreeGb }),
      jobs: options.jobs ?? new InMemoryWindowsJobInspector(),
      worktrees: options.worktrees ?? new InMemoryWorktreeSlotPool(),
      tiers: options.tiers ?? new InMemorySandboxTierSelector(),
      backend,
    });
    return new ThreePoolCapacityScheduler(options, execution, backend);
  }

  /** Warm inventory handed to Task 107 as `hardware_pool_cap` before that calculator applies pressure. */
  hardwarePoolCap(): number {
    return this.warmExecutionCap;
  }

  executionTarget(): number {
    return this.execution.effectiveTarget();
  }

  thinkingCap(): number {
    return this.thinking.capacity;
  }

  currentPressure(): GovernorPressure {
    return this.pressure;
  }

  setPressure(level: GovernorPressure): void {
    if (!isGovernorPressure(level)) {
      throw new CapacityError("invalid_request", "Unknown governor pressure");
    }
    this.pressure = level;
    this.ownedHeavyLane?.setMaxPermits(heavyLanePermitsFor(this.totalRamGb, level));
    this.recomputeTarget();
  }

  setDiskFreeGb(diskFreeGb: number): void {
    if (!Number.isFinite(diskFreeGb) || diskFreeGb < 0) {
      throw new CapacityError("invalid_request", "diskFreeGb must be a non-negative finite number");
    }
    this.diskFreeGb = diskFreeGb;
    this.recomputeTarget();
  }

  /**
   * Thinking width follows provider pacing and DAG width.
   * The execution hardware cap is intentionally not part of this min.
   */
  setThinkingBounds(bounds: { readonly providerPacingCap?: number; readonly dagDisjointWidth?: number }): void {
    if (bounds.providerPacingCap !== undefined) {
      assertNonNegativeInt(bounds.providerPacingCap, "providerPacingCap");
      this.providerPacingCap = bounds.providerPacingCap;
    }
    if (bounds.dagDisjointWidth !== undefined) {
      assertNonNegativeInt(bounds.dagDisjointWidth, "dagDisjointWidth");
      this.dagDisjointWidth = bounds.dagDisjointWidth;
    }
    this.applyThinkingCap();
  }

  snapshot(): CapacitySnapshot {
    const inspection = this.execution.inspect();
    return {
      thinkingCount: this.thinking.count("thinking"),
      waitingForRunSlotCount: this.thinking.count("waiting_for_run_slot"),
      runningSlotCount: inspection.runningSlotCount,
      slotOwnerTaskIds: inspection.slotOwnerTaskIds,
      executionTarget: inspection.effectiveTarget,
      warmExecutionSlots: inspection.warmSlotCount,
      sessionProcessActive: this.sessions.activeCount(),
      sessionProcessCap: this.sessions.cap,
      pressure: this.pressure,
      diskFreeGb: this.diskFreeGb,
      thinkingCap: this.thinking.capacity,
      waiterStatuses: inspection.waiterStatuses,
    };
  }

  admitThinking(taskId: string, signal?: AbortSignal): Promise<ReturnType<ThinkingPoolCoordinator["profile"]>> {
    return this.thinking.admit(taskId, signal);
  }

  releaseThinking(taskId: string): void {
    this.thinking.release(taskId);
  }

  async acquireExecution(request: ExecutionRequest): Promise<ExecutionLease> {
    if (!this.thinking.has(request.taskId)) {
      throw new CapacityError("not_admitted", `${request.taskId} has no thinking slot`);
    }
    if (request.signal?.aborted) {
      this.thinking.release(request.taskId);
      throw new AbortError();
    }
    this.thinking.setPhase(request.taskId, "waiting_for_run_slot");
    try {
      return await this.execution.acquire(request, {
        onGrant: () => this.thinking.setPhase(request.taskId, "running"),
      });
    } catch (error) {
      if (error instanceof AbortError) {
        if (this.thinking.has(request.taskId)) this.thinking.release(request.taskId);
      } else if (this.thinking.has(request.taskId) && this.thinking.phase(request.taskId) !== "running") {
        this.thinking.setPhase(request.taskId, "thinking");
      }
      throw error;
    }
  }

  releaseExecution(leaseId: string, reason: LeaseReleaseReason): ReleaseReport {
    const report = this.execution.release(leaseId, reason);
    if (!this.thinking.has(report.taskId)) return report;
    if (reason === "stop") this.thinking.release(report.taskId);
    else this.thinking.setPhase(report.taskId, "thinking");
    return report;
  }

  async runExecution<T>(
    request: ExecutionRequest,
    body: (lease: ExecutionLease) => Promise<T>,
  ): Promise<T> {
    const lease = await this.acquireExecution(request);
    let permit: HeavyLanePermit | null = null;
    let reason: LeaseReleaseReason = "finish";
    try {
      if (isHeavyCommand(request.commandClass)) {
        permit = await this.heavyLane.acquire({
          taskId: request.taskId,
          role: request.role,
          commandClass: request.commandClass,
        });
      }
      if (request.signal?.aborted) throw new AbortError();
      if (this.clock.now() > lease.deadlineAt) throw new ExecutionTimeoutError(lease);
      const result = await body(lease);
      if (this.clock.now() > lease.deadlineAt) throw new ExecutionTimeoutError(lease);
      return result;
    } catch (error) {
      if (error instanceof ExecutionTimeoutError) reason = "timeout";
      else if (error instanceof AbortError) reason = "stop";
      throw error;
    } finally {
      if (permit) this.heavyLane.release(permit.permitId);
      this.releaseExecution(lease.leaseId, reason);
    }
  }

  /**
   * Holds the single disk lane only around the command body, after the run slot is already leased.
   */
  runDiskExecution<T>(
    kind: DiskWriteKind,
    request: ExecutionRequest,
    body: (lease: ExecutionLease) => Promise<T>,
  ): Promise<T> {
    return this.runExecution(request, (lease) => this.disk.run(kind, () => body(lease)));
  }

  runDiskWrite<T>(kind: DiskWriteKind, operation: () => Promise<T>): Promise<T> {
    return this.disk.run(kind, operation);
  }

  spawnForeignSession(request: SpawnForeignSessionRequest): ResidentForeignSession {
    return this.sessions.spawn(request);
  }

  observeForeignSession(request: SpawnForeignSessionRequest): ResidentForeignSession {
    return this.sessions.observeResident(request);
  }

  enforceSessionCeiling(): ParkedForeignSession[] {
    return this.sessions.enforceCeiling();
  }

  auditExecutionSlots(): number {
    return this.execution.auditDirtySlots();
  }

  private applyThinkingCap(): void {
    const bound = this.parallelism.effectiveConcurrency({
      dagDisjointWidth: this.dagDisjointWidth,
      hardwarePoolCap: UNBOUNDED,
      providerPacingCap: this.providerPacingCap,
      worktreeSlotCap: UNBOUNDED,
      userPresetCap: UNBOUNDED,
    });
    this.thinking.setCapacity(Math.min(this.ramThinkingCap, bound));
  }

  private recomputeTarget(): void {
    this.execution.setDesiredTarget(
      executionTargetFor({
        warmSlots: this.warmExecutionCap,
        pressure: this.pressure,
        diskFreeGb: this.diskFreeGb,
      }),
    );
  }
}
