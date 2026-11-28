export const INTEGRATION_REF = "refs/heads/harness/integration";
export const FEATURE_REF_PREFIX = "refs/heads/harness/f/";
export const QUEUE_HOLDER = "project-merge-queue";
export const HARNESS_VERSION = "0.0.0";
export const MAX_BATCH = 3;
export const MAX_INTEGRATOR_ATTEMPTS = 2;
export const MAX_CAS_RETRIES = 5;
export const CONTEXT_LINES = 30;
export const REGRESSION_BUDGET_MS = 120_000;
export const LEASE_TTL_MS = 10 * 60 * 1000;

export const QUEUE_STATUSES = [
  "QUEUED",
  "STAGING",
  "VERIFYING",
  "LANDED",
  "EVICTED",
  "ESCALATED",
] as const;

export type QueueStatus = (typeof QUEUE_STATUSES)[number];

export const EF_TRAILER_KEYS = [
  "EF-Feature",
  "EF-Tasks",
  "EF-Requirements",
  "EF-Checks-Passed",
  "EF-Harness-Version",
] as const;

export const DONE_CONDITION_IDS = ["1", "2", "3", "4", "5", "6", "7"] as const;

export type DoneConditionId = (typeof DONE_CONDITION_IDS)[number];

export const TASK_SETTLED_STATES = ["MERGED_TO_FEATURE", "CANCELLED", "SUPERSEDED"] as const;

export const REQUIREMENT_KINDS_FOR_DONE = ["spec_item", "edge_case", "rule"] as const;

export const PREVIEW_RELOAD_KIND = "preview-reload";
export const FEATURE_COMPLETED_KIND = "FeatureCompleted";
