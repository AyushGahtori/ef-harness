/** 1024-based gibibyte. DXGI reports VRAM in bytes; 16 GB cards are this ceiling. */
export const GIB = 1024 * 1024 * 1024;

export const SINGLE_SLOT_VRAM_CEILING_BYTES = 16 * GIB;

export const JUNIOR_CONTEXT_FLOOR = 16_384;
export const SENIOR_CONTEXT_RECOMMENDED = 32_768;
export const OLLAMA_DEFAULT_NUM_CTX = 2_048;

export const DISCOVERY_TIMEOUT_MS = 1_500;
export const PROBE_TIMEOUT_MS = 15_000;
export const CREDIT_POLL_EVERY_TURNS = 10;
export const WIND_DOWN_RATIO = 0.9;

export const DEFAULT_OLLAMA_ORIGIN = "http://127.0.0.1:11434";
export const DEFAULT_LM_STUDIO_ORIGIN = "http://127.0.0.1:1234";
export const DEFAULT_OPENROUTER_ORIGIN = "https://openrouter.ai";

export const OPENROUTER_AUTHORIZE_PATH = "/auth";
export const OPENROUTER_EXCHANGE_PATH = "/api/v1/auth/keys";
export const OPENROUTER_KEY_PATH = "/api/v1/auth/key";

export const LOCAL_SLOT_CURRENCY = "local_slots" as const;
export const USD_CURRENCY = "usd" as const;
/** `global.db.connections.scale` for dollar amounts stored as micro-USD. */
export const MICRO_USD_SCALE = 1_000_000;

export const MAX_PARALLEL_SAME_WEIGHTS = 2;
export const LOCAL_RESPONSE_BYTE_CAP = 2_000_000;

export const NO_LOCAL_SERVERS_MESSAGE = "No local servers detected (Ollama / LM Studio)";
export const OLLAMA_STOPPED_MESSAGE = "Ollama isn't running — Start Ollama and click Retry";
export const LM_STUDIO_STOPPED_MESSAGE = "LM Studio isn't running — Start LM Studio and click Retry";

export const PROBE_TOOL_NAME = "ef_probe_ping";
export const PROBE_NONCE = "ef-probe-1";
export const PROBE_JSON_STATUS = "ok";

export const LOOPBACK_HOSTS = ["127.0.0.1", "localhost"] as const;

export type LoopbackHost = (typeof LOOPBACK_HOSTS)[number];
export type ExplicitNumCtx = 16_384 | 32_768;
export type LocalServerKind = "ollama" | "lm-studio";
