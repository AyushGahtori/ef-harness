/** Channel 0 carries JSON-RPC. Matches the window/daemon frame layout. */
export const JSON_RPC_CHANNEL = 0 as const;

/** Channel 1 carries binary artifact chunks. */
export const BINARY_STREAM_CHANNEL = 1 as const;

/** Every Channel 1 data frame payload is at most this many bytes. */
export const CHUNK_BYTES = 65_536;

/** Channel 0 JSON-RPC payload cap. Larger bodies must use `artifact.open`. */
export const JSON_IPC_MAX_BYTES = 1_048_576;

/** Alias used by the frame codec and the public barrel. */
export const JSON_RPC_MAX_BYTES = JSON_IPC_MAX_BYTES;

/** Chunks the daemon may send before the client grants more credit. */
export const DEFAULT_INITIAL_CREDITS = 8;

export const MIN_CREDIT_GRANT = 1;
export const MAX_CREDIT_GRANT = 256;

/** Credits granted but not yet consumed, per stream. */
export const MAX_OUTSTANDING_CREDITS = 512;

/**
 * Resident chunk ceiling. Eight 64 KB chunks is 512 KB, under the 1 MB
 * per-stream memory cap even when the client has granted more credit.
 */
export const MAX_PREFETCH_CHUNKS = DEFAULT_INITIAL_CREDITS;

/** Release a stream that is waiting on `stream.credit` for this long. */
export const DEFAULT_IDLE_TIMEOUT_MS = 60_000;

export const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
