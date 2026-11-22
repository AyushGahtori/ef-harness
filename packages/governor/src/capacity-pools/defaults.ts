import { CapacityError, assertFiniteNumber } from "./errors.js";
import { DISK_FORWARD_PROGRESS_FLOOR_GB, type GovernorPressure } from "./types.js";

export interface RamClassDefaults {
  readonly totalRamGb: number;
  readonly thinkingCap: number;
  readonly executionCap: number;
  readonly sessionProcessCap: number;
}

/**
 * Thinking stays wide (12 on a 16 GB laptop, 20 at 32 GB and above).
 * Warm execution stays narrow (2 / 3 / 4). Session-process caps follow the task:
 * 4 resident foreign CLIs at 16 GB and 8 at 32 GB and above.
 */
export function ramClassDefaults(totalRamGb: number): RamClassDefaults {
  assertFiniteNumber(totalRamGb, "totalRamGb");
  if (totalRamGb <= 0) {
    throw new CapacityError("invalid_request", "totalRamGb must be positive");
  }
  return {
    totalRamGb,
    thinkingCap: defaultThinkingCap(totalRamGb),
    executionCap: defaultExecutionCap(totalRamGb),
    sessionProcessCap: defaultSessionProcessCap(totalRamGb),
  };
}

export function defaultThinkingCap(totalRamGb: number): number {
  if (totalRamGb >= 32) return 20;
  if (totalRamGb > 16) return 16;
  return 12;
}

export function defaultExecutionCap(totalRamGb: number): number {
  if (totalRamGb >= 64) return 4;
  if (totalRamGb >= 32) return 3;
  return 2;
}

export function defaultSessionProcessCap(totalRamGb: number): number {
  if (totalRamGb >= 32) return 8;
  return 4;
}

/**
 * Lease target, not the warm-slot inventory.
 * In-flight leases are never killed when this number drops.
 * Yellow/Orange keep a floor of 1 unless the machine is Red or disk is below 2 GB.
 */
export function executionTargetFor(input: {
  readonly warmSlots: number;
  readonly pressure: GovernorPressure;
  readonly diskFreeGb: number;
}): number {
  const warm = Math.max(0, input.warmSlots);
  if (input.pressure === "Red" || input.diskFreeGb < DISK_FORWARD_PROGRESS_FLOOR_GB) {
    return 0;
  }
  if (input.pressure === "Orange") return Math.min(1, warm);
  if (input.pressure === "Yellow") return Math.min(warm, Math.max(1, warm - 1));
  return warm;
}
