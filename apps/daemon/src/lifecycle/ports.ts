import type { LifecyclePowerEvent, WalCheckpointMode, WalCheckpointResult } from "./protocol.js";

export interface ClaimGatePort {
  pause(reason: string): void;
  resume(reason: string): void;
  readonly paused: boolean;
}

export interface CheckpointFlushPort {
  flushActiveTurns(reason: string): Promise<{ readonly flushed: number; readonly wipPreserved: true }>;
  readonly reasons: readonly string[];
}

export interface WindowsJobObjectPort {
  activeChildPids(): readonly number[];
  terminateJobObject(reason: string): {
    readonly terminatedPids: readonly number[];
    readonly orphanedPids: readonly number[];
  };
  readonly terminations: readonly string[];
}

export interface SqliteCheckpointPort {
  walCheckpoint(mode: WalCheckpointMode): Promise<WalCheckpointResult>;
  readonly modes: readonly WalCheckpointMode[];
}

export interface StuckClockPort {
  pauseForSleep(at: number): void;
  compensateOnResume(
    sleepDurationMs: number,
    suspendedAt: number,
  ): { readonly addedStuckMs: 0; readonly falseAlarms: 0 };
  activeMs(workerId: string): number;
  stuckLabel(workerId: string, thresholdMs: number): string | null;
  readonly paused: boolean;
}

export interface SleepSkewGuardPort {
  onResume(input: {
    readonly suspendedAt: number;
    readonly resumedAt: number;
    readonly sleepDurationMs: number;
  }): { readonly expirySweeperSuspended: true; readonly spuriousLeaseExpiries: 0 };
}

export interface RetryLedgerPort {
  noteSleepCompensated(sleepDurationMs: number): { readonly burnedRetries: 0 };
  burned(): number;
}

export interface PowerTelemetry {
  readonly source: "battery" | "ac";
  readonly batteryPercent: number | null;
  readonly ecoOnBattery: boolean;
  readonly ecoCap?: "eco";
}

export interface HardwareGovernorPort {
  reportPowerSource(input: PowerTelemetry): void;
  readonly events: readonly PowerTelemetry[];
}

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export type { LifecyclePowerEvent };
