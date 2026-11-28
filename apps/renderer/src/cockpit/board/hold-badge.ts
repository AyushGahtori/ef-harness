import type { TaskHoldSnapshot } from "./types.js";

export interface HoldBadge {
  readonly text: string;
  readonly title: string;
}

export function isUserPauseReason(reason: string): boolean {
  const key = reason.toLowerCase();
  return key === "user_pause" || key === "user_paused";
}

function shortLabel(hold: TaskHoldSnapshot): string {
  const reason = hold.reason.toLowerCase();
  if (reason === "user_pause" || reason === "user_paused") return "paused";
  if (reason === "ambiguous_message") return "clarifying cutoff";
  const summary = hold.summary.trim();
  if (summary.length > 0) return summary;
  return hold.reason;
}

function exactReason(hold: TaskHoldSnapshot): string {
  const summary = hold.summary.trim();
  if (summary.length > 0) return summary;
  return shortLabel(hold);
}

export function holdBadge(holds: readonly TaskHoldSnapshot[]): HoldBadge | null {
  const first = holds[0];
  if (!first) return null;
  if (holds.length === 1) {
    const text = `Held: ${shortLabel(first)}`;
    const summary = first.summary.trim();
    return { text, title: summary.length > 0 ? summary : text };
  }
  return {
    text: `Held (${holds.length} reasons)`,
    title: holds.map((hold) => exactReason(hold)).join(" · "),
  };
}
