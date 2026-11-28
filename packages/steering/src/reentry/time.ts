export const TEN_MINUTES_MS = 10 * 60 * 1000;
export const THIRTY_MINUTES_MS = 30 * 60 * 1000;
export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
export const SIXTY_SECONDS_MS = 60 * 1000;
export const FIVE_GIBIBYTES = 5 * 1024 * 1024 * 1024;

export function parseTime(iso: string): number | null {
  const value = Date.parse(iso);
  return Number.isNaN(value) ? null : value;
}

export function formatDuration(ms: number): string {
  const abs = Math.abs(Math.trunc(ms));
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (abs < hour) {
    const minutes = Math.max(1, Math.round(abs / minute));
    return `${minutes}m`;
  }
  if (abs < day) {
    const hours = Math.max(1, Math.round(abs / hour));
    return `${hours}h`;
  }
  const days = Math.max(1, Math.round(abs / day));
  return `${days}d`;
}

export function formatAwayLabel(lastActiveIso: string, nowIso: string, supplied: string | null): string {
  if (supplied && supplied.trim()) return supplied;
  const last = parseTime(lastActiveIso);
  const now = parseTime(nowIso);
  if (last === null || now === null) return "unknown";
  const delta = Math.max(0, now - last);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (delta < minute) return "just now";
  if (delta < hour) {
    const minutes = Math.round(delta / minute);
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }
  if (delta < day) {
    const hours = Math.round(delta / hour);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  const days = Math.round(delta / day);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export type WakeKind = "under_10_min" | "under_30_min" | "over_30_min" | "environment_changed";

export function classifyWake(
  sleepMs: number,
  changes: { readonly repoChanged: boolean; readonly networkChanged: boolean; readonly offline: boolean },
): { readonly fastPath: boolean; readonly holdWelcomeBack: boolean; readonly kind: WakeKind } {
  const environmentChanged = changes.repoChanged || changes.networkChanged || changes.offline;
  if (sleepMs > THIRTY_MINUTES_MS) {
    return { fastPath: false, holdWelcomeBack: true, kind: "over_30_min" };
  }
  if (environmentChanged) {
    return { fastPath: false, holdWelcomeBack: true, kind: "environment_changed" };
  }
  if (sleepMs < TEN_MINUTES_MS) {
    return { fastPath: true, holdWelcomeBack: false, kind: "under_10_min" };
  }
  return { fastPath: false, holdWelcomeBack: false, kind: "under_30_min" };
}
