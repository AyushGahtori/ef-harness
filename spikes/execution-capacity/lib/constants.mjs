/** Provisional pool widths from execution-capacity.md. Measured runs replace them per RAM class. */
export const PROVISIONAL_POOLS = {
  "16gb": {
    thinking: 12,
    execution: 2,
    heavyLane: 1,
    sessionProcess: 2,
    services: { environments: 2, preview: true },
  },
  "32gb": {
    thinking: 20,
    execution: 4,
    heavyLane: 2,
    sessionProcess: 5,
    services: { environments: 4, preview: true },
  },
};

export const WORKER_COUNTS = [1, 5, 10, 20];
export const LOAD_PROFILES = ["idle", "active", "mixed"];
export const ISOLATION_MODES = ["own_loop", "session_process", "tier_a", "tier_c", "tier_d"];
export const RAM_CLASSES = ["16gb", "32gb"];
export const HEAVY_LANE_WIDTHS = [1, 2, 4];

/** Pass only when UI input-to-paint p95 is strictly under this value. */
export const UI_INPUT_LATENCY_PASS_MS = 50;

/**
 * Hard swapping threshold. `\Memory\Page Reads/sec` counts pages read from disk.
 * Soft faults are ignored. A cell fails this gate at or above the threshold.
 */
export const HARD_PAGE_READS_PER_SEC_MAX = 50;

/** Abort a cell when system commit charge exceeds 90% of the commit limit. */
export const COMMIT_CHARGE_ABORT_RATIO = 0.9;

/** Warn, and do not abort, when idle CPU is above this before the run. */
export const BASELINE_IDLE_CPU_WARN_PERCENT = 15;

export const MIXED_LOAD_SEED = 0x004ec001;

export const SAMPLE_COUNT = 3;
export const QUEUE_PRIORITIES = ["verifier", "worker", "background"];

/** Documented foreign-CLI idle cost. The spike scales this down when free RAM is short. */
export const SESSION_PROCESS_TARGET_BYTES = 300 * 1024 * 1024;

export const SAFETY_FREE_BYTES = 2 * 1024 * 1024 * 1024;

export function executionPoolWidth(ramClass, thinkingWidth) {
  const cap = ramClass === "32gb" ? PROVISIONAL_POOLS["32gb"].execution : PROVISIONAL_POOLS["16gb"].execution;
  return Math.min(cap, Math.max(1, thinkingWidth));
}
