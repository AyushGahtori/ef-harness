/** JSON-RPC 2.0 channel. Matches Task 008 `JSON_RPC_CHANNEL`. */
export const JSON_RPC_CHANNEL = 0 as const;

/** Binary stream channel. Matches Task 008 `BINARY_STREAM_CHANNEL`. */
export const BINARY_STREAM_CHANNEL = 1 as const;

/** Channel 0 payload ceiling. Matches Task 008 `JSON_IPC_MAX_BYTES`. */
export const JSON_IPC_MAX_BYTES = 1_048_576;

/** Channel 1 chunk ceiling. Matches Task 008 `BINARY_CHUNK_BYTES`. */
export const BINARY_CHUNK_BYTES = 65_536;

export const CURRENT_PROTOCOL = "1.1" as const;
export const SUPPORTED_PROTOCOLS = ["1.0", "1.1"] as const;
export type ProtocolVersion = (typeof SUPPORTED_PROTOCOLS)[number];

export const RPC_AUTH_FAILED = -32_001;
export const RPC_PROTOCOL_MISMATCH = -32_002;
export const RPC_PARSE_ERROR = -32_700;
export const RPC_INVALID_REQUEST = -32_600;
export const RPC_METHOD_NOT_FOUND = -32_601;
export const RPC_INTERNAL_ERROR = -32_603;

export const DEFAULT_HANDSHAKE_TIMEOUT_MS = 5_000;
export const DEFAULT_MAX_OUTBOUND_BYTES = JSON_IPC_MAX_BYTES;
export const DEFAULT_HEARTBEAT_MS = 30_000;
export const DEFAULT_BACKOFF_BASE_MS = 50;
export const DEFAULT_BACKOFF_MAX_MS = 2_000;
export const SESSION_TOKEN_LABEL = "SESSION_TOKEN";
export const SESSION_TOKEN_BYTES = 32;
export const SESSION_TOKEN_FILE = "session.token";
