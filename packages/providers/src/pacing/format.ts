import { PPM_SCALE } from "./constants.js";
import { PacingError } from "./errors.js";

export function clampPpm(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value);
  if (rounded <= 0) return 0;
  if (rounded >= PPM_SCALE) return PPM_SCALE;
  return rounded;
}

export function assertPpm(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > PPM_SCALE) {
    throw new PacingError("invalid_ppm", `${label} must be an integer ppm in 0..${PPM_SCALE}`);
  }
  return value;
}

/** "Keep 20% free" → 800_000 ppm harness ceiling. */
export function harnessCeilingPpm(reserveFraction: number): number {
  if (!(reserveFraction >= 0 && reserveFraction < 1)) {
    throw new PacingError("invalid_reserve", "Reserve fraction must be in [0, 1).");
  }
  const reservePpm = Math.round(reserveFraction * PPM_SCALE);
  return PPM_SCALE - reservePpm;
}

/** 90% of the harness ceiling. 800_000 → 720_000. */
export function windDownThresholdPpm(ceilingPpm: number): number {
  return Math.floor((ceilingPpm * 9) / 10);
}

export function atLeastRatio(
  usedPpm: number,
  ceilingPpm: number,
  numerator: number,
  denominator: number,
): boolean {
  if (ceilingPpm <= 0) return true;
  return usedPpm * denominator >= ceilingPpm * numerator;
}

const MIDDLE_DOT = "\u00B7";

/** `0:28` style countdown. Matches the Task 125 board clock. */
export function formatRetryCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const padded = seconds.toString().padStart(2, "0");
  return `${minutes}:${padded}`;
}

/** Calm board line: `Rate-limited · retrying in 0:28`. */
export function rateLimitLabel(remainingMs: number): string {
  return `Rate-limited ${MIDDLE_DOT} retrying in ${formatRetryCountdown(remainingMs)}`;
}

/** `~12% of 5h window` from an integer ppm share. 120_000 ppm is 12%. */
export function formatFiveHourShare(ppm: number): string {
  const clamped = clampPpm(ppm);
  const hundredths = Math.round(clamped / 100);
  const whole = Math.floor(hundredths / 100);
  const frac = hundredths % 100;
  if (frac === 0) return `~${whole}% of 5h window`;
  return `~${whole}.${frac.toString().padStart(2, "0")}% of 5h window`;
}

export function percentToPpm(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return clampPpm(percent * 10_000);
}
