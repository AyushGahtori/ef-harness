import type { CommandClass, PressureLevel } from "./types.js";

export const ENTER_WORSE_MS = 10_000;
export const RECOVER_BETTER_MS = 30_000;
export const EMERGENCY_ENTER_MS = 0;
export const CALIBRATION_BUDGET_MS = 3_000;

export const GiB = 1024 ** 3;
export const MiB = 1024 ** 2;

export const DISK_WARN_BYTES = 15 * GiB;
export const DISK_PAUSE_BYTES = 5 * GiB;
export const DISK_EMERGENCY_BYTES = 2 * GiB;

export const RAM_GREEN_FREE_RATIO = 0.25;
export const RAM_YELLOW_FREE_RATIO = 0.15;
export const RAM_ORANGE_FREE_RATIO = 0.08;
export const RAM_RED_FREE_RATIO = 0.04;
export const COMMIT_RED_RATIO = 0.95;
export const COMMIT_RECOVER_RATIO = 0.9;

export const DEFENDER_CONTENTION_RATIO = 0.25;
export const UI_LATENCY_YELLOW_MS = 50;
export const UI_LATENCY_ORANGE_MS = 100;

export const SAFETY_RESERVE_RATIO = 0.15;
export const SAFETY_RESERVE_MIN_MB = 2_048;

export const SSD_MAX_IO_MS = 8;
export const EMA_HIGH_WATERMARK_ALPHA = 0.3;
export const FOOTPRINT_SAMPLE_CAP = 64;

export const GB16_MB = 16 * 1024;
export const GB32_MB = 32 * 1024;

/** Conservative class defaults. `typecheck` is the tsc figure from the spec. */
export const COMMAND_CLASS_DEFAULT_MB: Readonly<Record<CommandClass, number>> = {
  typecheck: 900,
  unit_test: 400,
  playwright: 1_500,
  build: 2_048,
  pnpm_install: 1_000,
  db_migrate: 1_024,
};

export const WHISPER_VRAM_MB = {
  base: 512,
  small: 1_024,
  medium: 2_048,
} as const;

export type WhisperModelClass = keyof typeof WHISPER_VRAM_MB;

export const HEAVY_LANE_PRIORITY_WEIGHT = {
  verifier: 3,
  worker: 2,
  background: 1,
} as const;

export function defaultFootprintMb(commandClass: CommandClass): number {
  return COMMAND_CLASS_DEFAULT_MB[commandClass];
}

export function safetyReserveMb(totalRamMb: number): number {
  return Math.max(totalRamMb * SAFETY_RESERVE_RATIO, SAFETY_RESERVE_MIN_MB);
}

export function storageClassFromLatency(ioLatencyMs: number): "ssd" | "hdd" {
  return ioLatencyMs < SSD_MAX_IO_MS ? "ssd" : "hdd";
}

export function concurrencyCaps(totalRamMb: number): {
  readonly warmExecutionSlots: number;
  readonly thinkingSlots: number;
  readonly heavyLanePermits: number;
} {
  if (totalRamMb >= GB32_MB) {
    return { warmExecutionSlots: 4, thinkingSlots: 20, heavyLanePermits: 2 };
  }
  return { warmExecutionSlots: 2, thinkingSlots: 12, heavyLanePermits: 1 };
}

export function maxHeavyPermits(totalRamMb: number, level: PressureLevel): number {
  if (level === "RED") return 0;
  if (totalRamMb <= GB16_MB || level === "YELLOW" || level === "ORANGE") return 1;
  if (totalRamMb >= GB32_MB && level === "GREEN") return 2;
  return 1;
}

export function formatGbFromBytes(bytes: number): string {
  return (Math.round((bytes / GiB) * 10) / 10).toFixed(1);
}

export function formatGbFromMb(mb: number): string {
  return (Math.round((mb / 1024) * 10) / 10).toFixed(1);
}

export function mbFromBytes(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  return Math.ceil(bytes / MiB);
}
