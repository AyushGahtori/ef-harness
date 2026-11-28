export const ORACLE_FAMILY_NOTE =
  "Using a different model family for Oracles improves bug detection";

export const NO_CONNECTIONS_BANNER =
  "No active connections left — connect a provider before resuming";

export const LOUD_FALLBACK_WARNING =
  "Automatic capped fallback can spend real API money. A hard dollar cap is required.";

export const GEMINI_CLI_INVOCATION = "gemini --acp";

export const GEMINI_POLICY_NOTICE =
  "Gemini CLI (ACP) stays off until you accept this notice. Verify your Google account terms allow third-party ACP harness use. Your login stays inside Gemini CLI. Google does not allow apps to sign in to Gemini plans. If you reuse that login elsewhere, Google may suspend your account.";

export const CLAUDE_CODE_NOTICE = "Anthropic Console API key required";

export const PRIMARY_CARDS = [
  { id: "siwc", title: "Sign in with ChatGPT" },
  { id: "paste-api-key", title: "Paste API Key" },
  { id: "openrouter-pkce", title: "Connect OpenRouter (PKCE)" },
  { id: "copilot", title: "GitHub Copilot (Device / CLI)" },
  { id: "cursor", title: "Cursor (Browser)" },
  { id: "local-models", title: "Local Models (Auto-discovered Ollama / LM Studio)" },
] as const;

export const ROLES = [
  { id: "discoveryPlanning", label: "Discovery/Planning" },
  { id: "seniorCoding", label: "Senior Coding" },
  { id: "juniorCoding", label: "Junior Coding" },
  { id: "oracleReview", label: "Oracle/Review" },
] as const;

export type RoleId = (typeof ROLES)[number]["id"];

export function forbiddenProviderNeedle(): string {
  return ["anti", "gravity"].join("");
}

export function containsForbiddenProvider(text: string): boolean {
  return text.toLowerCase().includes(forbiddenProviderNeedle());
}
