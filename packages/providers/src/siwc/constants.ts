/** Sign in with ChatGPT protocol constants. Tokens never belong in these strings. */

export const SIWC_PREVIEW_LABEL =
  "ChatGPT Subscription · Direct Preview · Uses your ChatGPT 5h/weekly allowance";

export const SIWC_SCOPE_REJECTED_MESSAGE =
  "Your account didn't grant direct harness access (chatgpt.tokens.use.direct) — check plan eligibility or use an API key";

export const SIWC_SIGN_IN_EXPIRED_MESSAGE = "ChatGPT sign-in expired — Sign in again";

export const SIWC_ROUTE_REVOKED_GUIDANCE =
  "ChatGPT direct preview was revoked. Switch Connection, or use Codex CLI.";

export const SIWC_DIRECT_SCOPE = "chatgpt.tokens.use.direct";

export const SIWC_DYNAMIC_CLIENT_ID = "dynamic_agent_client";

export const SIWC_REQUESTED_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "resource.invoke",
  SIWC_DIRECT_SCOPE,
] as const;

export const SIWC_ISSUER = "https://auth.openai.com";

export const SIWC_RESOURCE = "https://api.openai.com/v1";

export const SIWC_AUTHORIZE_ENDPOINT = "https://auth.openai.com/api/accounts/authorize";

export const SIWC_TOKEN_ENDPOINT = "https://auth.openai.com/api/accounts/oauth/token";

export const SIWC_DISCOVERY_URL = "https://auth.openai.com/.well-known/openid-configuration";

export const SIWC_JWKS_URL = "https://auth.openai.com/.well-known/jwks.json";

export const SIWC_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";

export const SIWC_AGENT_NAME_HINT = "EF Harness";

export const CALLBACK_PATH = "/callback";

export const CALLBACK_TTL_MS = 120_000;

export const REFRESH_LEAD_MS = 120_000;

export const ACCESS_TOKEN_TTL_SECONDS = 3_600;

export const OUTPUT_TOKEN_CEILING = 16_384;

export const DEGENERATE_RUN_CHARS = 512;

export const STREAM_WALL_CLOCK_MS = 600_000;

export const CHARS_PER_TOKEN = 4;

export const HOST_ID_META_KEY = "ext_agent_host_id";

export const SIWC_FORBIDDEN_WIRE_FIELDS = [
  "max_output_tokens",
  "temperature",
  "previous_response_id",
  "background",
  "conversation",
  "max_tool_calls",
  "metadata",
  "moderation",
  "multi_agent",
  "prompt",
  "prompt_cache_retention",
  "safety_identifier",
  "top_logprobs",
  "top_p",
  "truncation",
  "user",
] as const;

export const SIWC_BANNED_TOOL_TYPES = [
  "file_search",
  "code_interpreter",
  "computer_use",
  "computer_use_preview",
  "mcp",
  "hosted_mcp",
  "tool_search",
  "image_generation",
  "programmatic_tool_calling",
] as const;

export const TERMINAL_REFRESH_ERRORS = [
  "invalid_grant",
  "invalid_refresh_token",
  "token_expired",
  "refresh_token_expired",
  "refresh_token_invalidated",
  "refresh_token_reused",
] as const;
