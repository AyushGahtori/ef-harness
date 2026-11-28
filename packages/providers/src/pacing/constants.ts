/** Parts per million of a provider allowance window. 1_000_000 ppm is the full window. */
export const PPM_SCALE = 1_000_000;

/** TCP-style start. Cold starts stay at two in-flight turns so minute-one bursts do not trip RPM limits. */
export const AIMD_START_CWND = 2;

export const AIMD_CLEAN_COMPLETIONS = 6;

export const AIMD_CLEAN_WINDOW_MS = 60_000;

/** After a transient 429, additive increase stays frozen for this long. */
export const AIMD_COOLDOWN_MS = 60_000;

/** Transient Retry-After waits are capped so a bad header cannot park a connection for hours. */
export const RETRY_AFTER_CAP_MS = 120_000;

/** Upper bound of the added jitter, as a fraction of the capped Retry-After. */
export const RETRY_JITTER_FRACTION = 0.2;

/** Used when a bare 429 arrives with no Retry-After header and no "try again in" hint. */
export const DEFAULT_RETRY_AFTER_MS = 20_000;

/** Wind-down starts at 90% of the harness ceiling (the share left after the personal reserve). */
export const WIND_DOWN_NUMERATOR = 9;

export const WIND_DOWN_DENOMINATOR = 10;

/** First gentle step-down of paced concurrency. */
export const BURN_STEP_70_NUMERATOR = 7;

/** Second gentle step-down of paced concurrency. */
export const BURN_STEP_80_NUMERATOR = 8;

export const BURN_STEP_DENOMINATOR = 10;

/** Reservation safety margin from provider-connections: tokens × k × 1.3. */
export const RESERVATION_SAFETY_MARGIN = 1.3;

/** Opt-in auto-resume wakes this long after the persisted reset timestamp. */
export const AUTO_RESUME_JITTER_MS = 15_000;

export const DISK_HEADROOM_MIN_BYTES = 5 * 1024 * 1024 * 1024;

export const INTERACTIVE_SLOT_COUNT = 1;

/** Conservative ppm per 1k tokens when Task 135 has no signed prior for the model. */
export const CONSERVATIVE_PRIOR_PPM_PER_1K = 20_000;

export const LEARNER_MAX_STEP_FRACTION = 0.25;

export const LEARNER_FORGETTING = 0.98;

export const LEARNER_MIN_COVARIANCE = 0.05;

export const LEARNER_EMA_ALPHA = 0.35;

export const CALIBRATED_SAMPLE_COUNT = 3;

export const FIVE_HOUR_MS = 5 * 60 * 60 * 1000;

export const SEVEN_DAY_MS = 7 * 24 * 60 * 60 * 1000;

export const CHECKPOINT_STOP_ACTIONS = [
  "wait_for_reset",
  "switch_connection",
  "keep_parked",
] as const;

export const INTERACTIVE_ROLES = [
  "ask-owner-responder@1",
  "discovery",
  "canvas-qa",
  "steering-router",
  "steering",
] as const;
