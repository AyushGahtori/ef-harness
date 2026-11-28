import type { PoolState } from "./types.js";

const MIDDLE_DOT = "\u00B7";

export function formatMinuteClock(elapsedMs: number): string {
  const minutes = Math.max(0, Math.floor(elapsedMs / 60_000));
  return `${minutes}m`;
}

/** `0:45` style countdown. Zero remaining is `0:00`. */
export function formatRetryCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const padded = seconds.toString().padStart(2, "0");
  return `${minutes}:${padded}`;
}

/** `1h 18m` when at least an hour remains, otherwise `18m`. */
export function formatAllowanceGap(remainingMs: number): string {
  const totalMinutes = Math.max(0, Math.floor(remainingMs / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

export function stuckLabel(elapsedMs: number): string {
  return `No progress ${MIDDLE_DOT} ${formatMinuteClock(elapsedMs)}`;
}

export function waitingRunSlotLabel(elapsedMs: number): string {
  return `Waiting for run slot ${MIDDLE_DOT} ${formatMinuteClock(elapsedMs)}`;
}

export function rateLimitLabel(remainingMs: number): string {
  return `Rate-limited ${MIDDLE_DOT} retrying in ${formatRetryCountdown(remainingMs)}`;
}

export function allowanceLabel(providerLabel: string, remainingMs: number): string {
  const name = allowanceDisplayName(providerLabel);
  return `Paused for ${name} reset ${MIDDLE_DOT} ${formatAllowanceGap(remainingMs)}`;
}

export function loopLabel(count: number): string {
  return `Repeating error ${count}\u00D7`;
}

export function retryEscalationLabel(
  hintLevel: number,
  attemptLimit: number,
  tier: string | null,
): string {
  const head = `Retry ${hintLevel}/${attemptLimit}`;
  if (tier) {
    return `${head} ${MIDDLE_DOT} ${tier} escalated`;
  }
  return `${head} ${MIDDLE_DOT} escalated`;
}

export function exhaustedLabel(failedAttempts: number, attemptLimit: number): string {
  return `Needs help \u2014 ${failedAttempts}/${attemptLimit} retries failed`;
}

export const DISPUTE_LABEL = "Test disputed \u2014 needs review";

export const SUMMARY_JOINER = ` ${MIDDLE_DOT} `;

/**
 * ChatGPT Plus / Copilot / Cursor all collapse to the short name used on the pill.
 * Unknown labels are kept so a new subscription is still readable.
 */
export function allowanceDisplayName(providerLabel: string): string {
  const lower = providerLabel.toLowerCase();
  if (lower.includes("chatgpt")) return "ChatGPT";
  if (lower.includes("copilot")) return "Copilot";
  if (lower.includes("cursor")) return "Cursor";
  return providerLabel;
}

/**
 * Task 119 names the phase `waiting_for_run_slot`. Task 125's rule uses
 * `waiting_run_slot`. Both mean Pool 2, and neither is a stuck alarm.
 */
export function normalizePoolState(value: string): PoolState {
  if (value === "waiting_run_slot" || value === "waiting_for_run_slot") {
    return "waiting_run_slot";
  }
  if (value === "thinking") return "thinking";
  return "running";
}

export function joinSummary(parts: readonly string[]): string {
  return parts.join(SUMMARY_JOINER);
}

export function healthyVerbose(workerCount: number): string {
  return `All ${workerCount} workers healthy`;
}

export function healthyCalm(workerCount: number): string {
  return `All ${workerCount} healthy`;
}
