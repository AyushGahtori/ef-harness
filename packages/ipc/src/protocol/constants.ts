/** Database-design cap: one snapshot.get view section stays at or under 2 MB. */
export const MAX_SNAPSHOT_SECTION_BYTES = 2 * 1024 * 1024;

/**
 * Channel 0 carries one JSON-RPC frame. Task 031 rejects frames above 1 MB,
 * so a snapshot page and an events.batch notification must fit in that frame.
 * 1 MB is inside the 2 MB section cap.
 */
export const CHANNEL0_MAX_FRAME_BYTES = 1_048_576;

export const MAX_SNAPSHOT_FRAME_BYTES = CHANNEL0_MAX_FRAME_BYTES;

/** Commits allowed during keyset pagination before the pin is discarded. */
export const DEFAULT_SNAPSHOT_SEQ_BUFFER = 32;

export const DEFAULT_REPLAY_PAGE_SIZE = 200;

export const MAX_EVENT_BATCH_EVENTS = 100;

/** Oldest telemetry notices past this depth are shed per client. */
export const DEFAULT_MAX_QUEUED_TELEMETRY = 32;

export const PROTOCOL_VERSION = "1.1";

/** Daemon accepts the current minor and the previous minor (`session.hello` protocol `1.x`). */
export const SUPPORTED_PROTOCOL_VERSIONS: readonly [string, ...string[]] = supportedProtocols(PROTOCOL_VERSION);

function supportedProtocols(current: string): [string, ...string[]] {
  const match = /^(\d+)\.(\d+)$/u.exec(current);
  const major = match?.[1] ?? "1";
  const minor = Number(match?.[2] ?? "0");
  const currentVersion = `${major}.${Number.isFinite(minor) ? minor : 0}`;
  if (!Number.isFinite(minor) || minor <= 0) return [currentVersion];
  return [`${major}.${minor - 1}`, currentVersion];
}

export const JSON_RPC_PARSE_ERROR = -32700;
export const JSON_RPC_INVALID_REQUEST = -32600;
export const JSON_RPC_METHOD_NOT_FOUND = -32601;
export const JSON_RPC_INVALID_PARAMS = -32602;
export const JSON_RPC_INTERNAL_ERROR = -32603;
export const JSON_RPC_UNAUTHORIZED = -32001;
export const JSON_RPC_OP_ID_REUSED = -32003;
export const JSON_RPC_PROJECT_NOT_FOUND = -32004;
export const JSON_RPC_SNAPSHOT_ITEM_TOO_LARGE = -32010;

export const SNAPSHOT_VIEWS = [
  "board",
  "feature_progress",
  "inbox",
  "holds",
  "runtime",
  "budget",
] as const;

export type SnapshotViewName = (typeof SNAPSHOT_VIEWS)[number];
