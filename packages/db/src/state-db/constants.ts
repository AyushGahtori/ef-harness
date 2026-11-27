import { PRODUCTION_SCHEMA_VERSION, productionMigrations } from "../migrations/production.js";
import { maxKnownSchemaVersion } from "../migrations/registry.js";

/**
 * Highest `state.db` user_version this binary opens.
 * Lower versions run forward migrations. A higher version is refused.
 */
export const APP_SUPPORTED_SCHEMA_VERSION = maxKnownSchemaVersion(
  productionMigrations,
  "state",
  PRODUCTION_SCHEMA_VERSION,
);

export const BOOTSTRAP_MIGRATION_NAME = "state-schema-v1";
export const BOOTSTRAP_MIGRATION_KIND = "additive" as const;
export const DEFAULT_APP_VERSION = "0.0.0";

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export const JOURNAL_SIZE_LIMIT_BYTES = 67_108_864;
export const WRITER_BUSY_TIMEOUT_MS = 5_000;

export const META_KEYS = {
  projectId: "project_id",
  streamEpoch: "stream_epoch",
  lastRev: "last_rev",
  writerEpoch: "writer_epoch",
  createdAt: "created_at",
  owner: "owner",
  lastIntegrityCheckAt: "last_integrity_check_at",
  safeMode: "safe_mode",
  safeModeReason: "safe_mode_reason",
  safeModeDiagnostics: "safe_mode_diagnostics",
} as const;

export const INITIAL_STREAM_EPOCH = 1;
export const INITIAL_WRITER_EPOCH = 1;
export const INITIAL_LAST_REV = 0;

/** Windows rename races: 50 ms, then doubling, capped at 1 s, ten attempts. */
export const RENAME_DELAYS_MS = [50, 100, 200, 400, 800, 1_000, 1_000, 1_000, 1_000, 1_000] as const;

export const SCHEMA_VIEWS = [
  "requirements",
  "task_requirements",
  "check_requirements",
  "waivers",
] as const;
