/** Parts per million of a provider allowance window. 1_000_000 ppm is the full window. */
export const PPM_SCALE = 1_000_000;

export const PERSONAL_RESERVE_FRACTION = 0.2;

export const AIMD_START_CWND = 2;

export const AIMD_CLEAN_COMPLETIONS = 6;

export const AIMD_COOLDOWN_MS = 60_000;

export const RESERVATION_SAFETY_MARGIN = 1.3;

export const FIVE_HOUR_WINDOW_MS = 5 * 60 * 60 * 1000;

export const IDLE_PARK_AFTER_MS = 90_000;

export const IDLE_WAIT_OBSERVED_MS = 120_000;

export const INTERRUPT_LIMIT_MS = 2_000;

export const CACHE_HIT_LIMIT_MS = 2;

export const PASS_RATE_FLOOR = 0.9;

export const CONFORMANCE_SUITE_VERSION = "m4-conformance@1";

export const REPORT_SCHEMA = "m4-exit-gate-report@1";

export const PRIOR_UNVERIFIED_WIP = "[PRIOR UNVERIFIED WIP]";

export const EPHEMERAL_DIR_NAMES = ["CODEX_HOME", "codex-skills-tmp"] as const;

export const COMPLIANT_ADAPTER_IDS = [
  "generic-acp",
  "codex",
  "copilot",
  "cursor",
  "claude-code",
  "gemini-cli",
  "opencode",
] as const;

export const PROBE_IDS = ["P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08", "P09", "P10"] as const;

export const SECURITY_PROBE_IDS = ["P02", "P05", "P06", "P07"] as const;

export const SIWC_FORBIDDEN_WIRE_FIELDS = [
  "max_output_tokens",
  "temperature",
  "previous_response_id",
] as const;

export const PAID_REQUEST_MICRO_USD = 250_000;

export const RESERVE_EDGE_USED_NUMERATOR = 89;

export const RESERVE_EDGE_ACTIVE_PPM = 18_000;

export const RESERVE_EDGE_QUEUED = 3;

export const RESERVE_EDGE_QUEUED_PPM = 40_000;
