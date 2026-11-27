import type { WorkerTier } from "@ef-harness/shared-contracts";

/** Owner defaults from the 17 November 2026 auto-start decision. Settings may only tighten these. */
export const DELTA_TASK_CEILING = 5;
export const DELTA_COST_CEILING_MICRO_USD = 1_000_000n;
export const DELTA_WINDOW_CEILING_PPM = 20_000;
export const DAILY_CAP_MICRO_USD = 5_000_000n;
export const DAILY_WINDOW_CAP_PPM = 100_000;
export const PLAN_WINDOW_PPM = 1_000_000;
export const ROLLING_WINDOW_MS = 24 * 60 * 60 * 1000;
export const UNDO_WINDOW_MS = 10_000;
export const PAUSE_AFFORDANCE_MS = 5_000;
export const PRESET_RECOMPUTE_BUDGET_MS = 30;
export const PAPERWORK_CAP_PPM = 200_000;
export const UNIT_SCALE = 1_000_000n;

export const PAPERWORK_LINE =
  "Research 3% · Arch 5% · Plan/Oracles 6% · Integration/Review 4% · Audit 2%";

export const PAPERWORK_ENVELOPES = [
  { id: "research", label: "Research", percentLabel: "3%", ppm: 30_000 },
  { id: "architecture", label: "Arch", percentLabel: "5%", ppm: 50_000 },
  { id: "planning", label: "Plan/Oracles", percentLabel: "6%", ppm: 60_000 },
  { id: "integration_review", label: "Integration/Review", percentLabel: "4%", ppm: 40_000 },
  { id: "final_audit", label: "Audit", percentLabel: "2%", ppm: 20_000 },
] as const;

export const PHASE0_STEPS = ["P0.1", "P0.2", "P0.3", "P0.4", "P0.5", "P0.6", "P0.7", "P0.8"] as const;

export const PRESET_PEAK_WORKERS = {
  Fastest: 7,
  Balanced: 5,
  Cheapest: 3,
} as const;

export const LEVEL_COST_PERCENT: Readonly<Record<WorkerTier, number>> = {
  Junior: 100,
  Mid: 180,
  Senior: 320,
  Principal: 640,
};
