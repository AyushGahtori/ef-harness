export const PREVIEW_PORT_MIN = 41_000;
export const PREVIEW_PORT_MAX = 48_999;

/** Last-good health requires HTTP 200 and zero startup crashes inside this window. */
export const HEALTHY_BOOT_WINDOW_MS = 5_000;

/** A preview that never answers within this window is a failed boot. */
export const HEALTH_PROBE_FAIL_MS = 20_000;

/** Exit-code boot failures must be detected inside this window. */
export const CRASH_DETECT_MS = 10_000;

/** Hidden or closed Preview suspends after this idle interval. */
export const HIDDEN_SUSPEND_MS = 15 * 60 * 1000;

/** Explicit Reset Demo Data must finish, including a preview reload, inside this budget. */
export const RESET_DEMO_BUDGET_MS = 2_000;

export interface PreviewTimings {
  readonly healthyBootWindowMs: number;
  readonly healthProbeFailMs: number;
  readonly crashDetectMs: number;
  readonly hiddenSuspendMs: number;
  readonly resetDemoBudgetMs: number;
}

export const DEFAULT_PREVIEW_TIMINGS: PreviewTimings = {
  healthyBootWindowMs: HEALTHY_BOOT_WINDOW_MS,
  healthProbeFailMs: HEALTH_PROBE_FAIL_MS,
  crashDetectMs: CRASH_DETECT_MS,
  hiddenSuspendMs: HIDDEN_SUSPEND_MS,
  resetDemoBudgetMs: RESET_DEMO_BUDGET_MS,
};

export function resolvePreviewTimings(override?: Partial<PreviewTimings>): PreviewTimings {
  return {
    healthyBootWindowMs: override?.healthyBootWindowMs ?? DEFAULT_PREVIEW_TIMINGS.healthyBootWindowMs,
    healthProbeFailMs: override?.healthProbeFailMs ?? DEFAULT_PREVIEW_TIMINGS.healthProbeFailMs,
    crashDetectMs: override?.crashDetectMs ?? DEFAULT_PREVIEW_TIMINGS.crashDetectMs,
    hiddenSuspendMs: override?.hiddenSuspendMs ?? DEFAULT_PREVIEW_TIMINGS.hiddenSuspendMs,
    resetDemoBudgetMs: override?.resetDemoBudgetMs ?? DEFAULT_PREVIEW_TIMINGS.resetDemoBudgetMs,
  };
}
