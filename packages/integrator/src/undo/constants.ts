export const INTEGRATION_BRANCH = "harness/integration";
export const INTEGRATION_REF = "refs/heads/harness/integration";
export const FEATURE_BRANCH_PREFIX = "harness/f/";
export const FEATURE_REF_PREFIX = "refs/heads/harness/f/";
export const ARCHIVE_FEATURE_PREFIX = "refs/harness/archive/f/";
export const CHECKPOINT_PREFIX = "refs/harness/checkpoints/";
export const ARCHIVE_CHECKPOINT_PREFIX = "refs/harness/archive/checkpoints/";
export const UNDO_HOLDER = "feature-undo";
export const PHASE0_SHARED = "phase0-shared";
export const HARNESS_VERSION = "0.0.0";
export const LEASE_TTL_MS = 10 * 60 * 1000;
export const LLM_TOKENS = 0;
export const IN_FLIGHT_STATES = ["QUEUED", "WORKING", "INTEGRATING"] as const;
export const USAGE_EDGE_TYPES = ["consumes", "consumes_contract", "implements"] as const;
export const HARD_EDGE_TYPE = "depends_on";
export const EF_TRAILER_KEYS = [
  "EF-Feature",
  "EF-Tasks",
  "EF-Requirements",
  "EF-Checks-Passed",
  "EF-Harness-Version",
] as const;

export const DATA_KEEP_DORMANT = "keep_dormant";
export const DATA_DROP = "drop_in_new_migration";
export const MODE_FAST_PATH = "fast_path_revert";
export const MODE_SURGICAL = "surgical_removal";
