import type { DaemonShutdownCoordinator } from "./daemon-shutdown-coordinator.js";
import type {
  CheckpointFlushPort,
  ClaimGatePort,
  HardwareGovernorPort,
  RetryLedgerPort,
  SleepSkewGuardPort,
  StuckClockPort,
} from "./ports.js";
import { DRAIN_BUDGET_MS, type LifecyclePowerEvent } from "./protocol.js";

export interface PowerLifecycleDependencies {
  readonly now: () => number;
  readonly claims: ClaimGatePort;
  readonly clocks: StuckClockPort;
  readonly leases: SleepSkewGuardPort;
  readonly retries: RetryLedgerPort;
  readonly governor: HardwareGovernorPort;
  readonly shutdown: DaemonShutdownCoordinator;
  readonly checkpoints: CheckpointFlushPort;
}

export class PowerLifecycleHandler {
  private suspendedAt: number | null = null;
  private locked = false;

  constructor(private readonly deps: PowerLifecycleDependencies) {}

  isLocked(): boolean {
    return this.locked;
  }

  async handle(event: LifecyclePowerEvent): Promise<void> {
    if (event.type === "suspend") {
      this.suspendedAt = event.at;
      this.deps.claims.pause("suspend");
      await this.deps.checkpoints.flushActiveTurns("suspend");
      this.deps.clocks.pauseForSleep(event.at);
      return;
    }
    if (event.type === "resume") {
      const suspendedAt = this.suspendedAt ?? event.at - event.sleepDurationMs;
      const clocks = this.deps.clocks.compensateOnResume(event.sleepDurationMs, suspendedAt);
      const leases = this.deps.leases.onResume({
        suspendedAt,
        resumedAt: event.at,
        sleepDurationMs: event.sleepDurationMs,
      });
      const retries = this.deps.retries.noteSleepCompensated(event.sleepDurationMs);
      if (clocks.addedStuckMs !== 0 || clocks.falseAlarms !== 0 || leases.spuriousLeaseExpiries !== 0) {
        throw new Error("Sleep duration counted against stuck clocks or leases");
      }
      if (retries.burnedRetries !== 0 || this.deps.retries.burned() !== 0) {
        throw new Error("Sleep burned retries");
      }
      if (event.resumeClaiming) this.deps.claims.resume("resume");
      else this.deps.claims.pause("welcome-back");
      this.suspendedAt = null;
      return;
    }
    if (event.type === "shutdown") {
      await this.deps.shutdown.shutdown({
        mode: "drain_and_exit",
        reason: "os-shutdown",
        deadlineMs: DRAIN_BUDGET_MS,
      });
      return;
    }
    if (event.type === "on-battery") {
      this.deps.governor.reportPowerSource(this.telemetry("battery", event.batteryPercent, event.ecoOnBattery));
      return;
    }
    if (event.type === "on-ac") {
      this.deps.governor.reportPowerSource({
        source: "ac",
        batteryPercent: null,
        ecoOnBattery: false,
      });
      return;
    }
    if (event.type === "lock-screen") {
      this.locked = true;
      return;
    }
    this.locked = false;
  }

  private telemetry(
    source: "battery",
    batteryPercent: number | null,
    ecoOnBattery: boolean,
  ) {
    if (ecoOnBattery) {
      return { source, batteryPercent, ecoOnBattery: true, ecoCap: "eco" as const };
    }
    return { source, batteryPercent, ecoOnBattery: false };
  }
}
