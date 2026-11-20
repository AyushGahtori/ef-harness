/** Uncompressed size above which text logs use the seekable zstd format. */
export const SEEKABLE_TEXT_THRESHOLD_BYTES = 1024 * 1024;

/** Target uncompressed size of one independently decodable zstd frame. */
export const SEEKABLE_FRAME_BYTES = 1024 * 1024;

/** Sidecar records a line position every N lines (1-based line numbers). */
export const LINE_INDEX_SAMPLE_EVERY = 1000;

export const DEFAULT_STORAGE_CAP_BYTES = 10 * 1024 * 1024 * 1024;

export const DIAGNOSTIC_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

export const EPHEMERAL_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;

export const DEFAULT_SEARCH_BYTE_BUDGET = 16 * 1024 * 1024;

export const DEFAULT_SEARCH_TIME_BUDGET_MS = 2_000;

export const DEFAULT_SCRUB_SAMPLE_SIZE = 64;

/** A single assembled line, including bytes carried across frames, cannot grow past this. */
export const MAX_ASSEMBLED_LINE_BYTES = 8 * 1024 * 1024;

/** Corrupt seek tables cannot force a multi-gigabyte frame allocation. */
export const MAX_FRAME_UNCOMPRESSED_BYTES = 8 * 1024 * 1024;

export const ARCHIVABLE_ATTEMPT_STATES = ["accepted", "rejected", "fenced", "crashed"] as const;

export const PROTECTED_ATTEMPT_STATES = ["running", "submitted", "parked"] as const;

export type ArchivableAttemptState = (typeof ARCHIVABLE_ATTEMPT_STATES)[number];

export type ProtectedAttemptState = (typeof PROTECTED_ATTEMPT_STATES)[number];

export function isArchivableAttemptState(state: string): state is ArchivableAttemptState {
  return (ARCHIVABLE_ATTEMPT_STATES as readonly string[]).includes(state);
}
