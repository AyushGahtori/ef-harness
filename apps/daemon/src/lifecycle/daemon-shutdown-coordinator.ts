import type {
  CheckpointFlushPort,
  ClaimGatePort,
  Clock,
  SqliteCheckpointPort,
  WindowsJobObjectPort,
} from "./ports.js";
import {
  DRAIN_BUDGET_MS,
  IDLE_DRAIN_BUDGET_MS,
  type LifecycleShutdownRequest,
  type LifecycleShutdownResponse,
} from "./protocol.js";

export interface DaemonShutdownDependencies {
  readonly clock: Clock;
  readonly claims: ClaimGatePort;
  readonly checkpoints: CheckpointFlushPort;
  readonly jobs: WindowsJobObjectPort;
  readonly sqlite: SqliteCheckpointPort;
}

export class DaemonShutdownCoordinator {
  private exitRequested = false;
  private uiAttached = true;

  constructor(private readonly deps: DaemonShutdownDependencies) {}

  isRunning(): boolean {
    return !this.exitRequested;
  }

  isUiAttached(): boolean {
    return this.uiAttached;
  }

  async shutdown(request: LifecycleShutdownRequest): Promise<LifecycleShutdownResponse> {
    const started = this.deps.clock.now();
    if (request.mode === "detach_ui_keep_running") {
      this.uiAttached = false;
      return {
        ok: true,
        mode: request.mode,
        exited: false,
        daemonKeptRunning: true,
        orphanedProcesses: 0,
        elapsedMs: this.deps.clock.now() - started,
        timedOut: false,
        stateDbIntact: true,
        walModes: [],
        buildsInterrupted: false,
        uiDetached: true,
      };
    }
    const budget = this.budgetFor(request);
    const drained = await this.drain(budget, request.idle === true, request.reason);
    this.exitRequested = true;
    this.uiAttached = false;
    return {
      ok: true,
      mode: "drain_and_exit",
      exited: true,
      daemonKeptRunning: false,
      orphanedProcesses: 0,
      elapsedMs: this.deps.clock.now() - started,
      timedOut: drained.timedOut,
      stateDbIntact: true,
      walModes: ["PASSIVE", "TRUNCATE"],
      buildsInterrupted: drained.flushed > 0 && request.idle !== true,
      uiDetached: true,
    };
  }

  private budgetFor(request: LifecycleShutdownRequest): number {
    const requested = request.deadlineMs ?? DRAIN_BUDGET_MS;
    const cap = request.idle === true ? IDLE_DRAIN_BUDGET_MS : DRAIN_BUDGET_MS;
    if (!Number.isFinite(requested) || requested < 0) return cap;
    return Math.min(requested, cap);
  }

  private async drain(
    budgetMs: number,
    idle: boolean,
    reason: string,
  ): Promise<{ readonly timedOut: boolean; readonly flushed: number }> {
    const started = this.deps.clock.now();
    const deadline = started + budgetMs;
    this.deps.claims.pause(reason);
    const flushed = await this.deps.checkpoints.flushActiveTurns(reason);
    let timedOut = false;
    if (!idle) {
      while (this.deps.jobs.activeChildPids().length > 0 && this.deps.clock.now() < deadline) {
        const before = this.deps.clock.now();
        const step = Math.min(50, deadline - before);
        await this.deps.clock.sleep(step);
        if (this.deps.clock.now() <= before) {
          timedOut = true;
          break;
        }
      }
    }
    if (this.deps.jobs.activeChildPids().length > 0) {
      timedOut = timedOut || this.deps.clock.now() >= deadline || idle;
      this.deps.jobs.terminateJobObject(idle ? "idle-quit" : "drain-timeout");
    }
    if (this.deps.jobs.activeChildPids().length !== 0) {
      throw new Error("Job Object cleanup left orphaned processes");
    }
    const passive = await this.deps.sqlite.walCheckpoint("PASSIVE");
    const truncate = await this.deps.sqlite.walCheckpoint("TRUNCATE");
    if (passive.busy < 0 || truncate.busy !== 0) {
      throw new Error("state.db WAL checkpoint did not complete");
    }
    if (!flushed.wipPreserved) {
      throw new Error("WIP checkpoints were not preserved");
    }
    return { timedOut, flushed: flushed.flushed };
  }
}
