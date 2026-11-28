export type PastedKeyProvider = "anthropic_console" | "openai" | "openrouter" | "gemini";

export const ANTHROPIC_COMPLIANCE_MESSAGE =
  "Claude Code uses Anthropic Console API keys only (subscription OAuth is withdrawn)";

function joined(parts: readonly string[]): string {
  return parts.join("");
}

const ANTHROPIC_CONSOLE_PREFIX = joined(["sk", "-ant", "-api"]);
const ANTHROPIC_SUBSCRIPTION_PREFIX = joined(["sk", "-ant", "-oat"]);
const ANTHROPIC_FAMILY_PREFIX = joined(["sk", "-ant", "-"]);
const SETUP_TOKEN_MARKER = joined(["setup", "-", "token"]);
const OPENAI_PROJECT_PREFIX = joined(["sk", "-proj", "-"]);
const OPENROUTER_PREFIX = joined(["sk", "-or", "-v1", "-"]);

export function anthropicPasteRejection(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.toLowerCase().includes(SETUP_TOKEN_MARKER)) return ANTHROPIC_COMPLIANCE_MESSAGE;
  if (trimmed.startsWith(ANTHROPIC_SUBSCRIPTION_PREFIX)) return ANTHROPIC_COMPLIANCE_MESSAGE;
  if (trimmed.startsWith(ANTHROPIC_FAMILY_PREFIX) && !trimmed.startsWith(ANTHROPIC_CONSOLE_PREFIX)) {
    return ANTHROPIC_COMPLIANCE_MESSAGE;
  }
  return null;
}

export function detectPastedKeyProvider(raw: string): PastedKeyProvider | null {
  const trimmed = raw.trim();
  if (anthropicPasteRejection(trimmed)) return null;
  if (trimmed.startsWith(ANTHROPIC_CONSOLE_PREFIX)) return "anthropic_console";
  if (trimmed.startsWith(OPENROUTER_PREFIX)) return "openrouter";
  if (trimmed.startsWith(OPENAI_PROJECT_PREFIX) || trimmed.startsWith("sk-")) return "openai";
  if (trimmed.startsWith("AIza")) return "gemini";
  return null;
}

export function pastedProviderLabel(provider: PastedKeyProvider): string {
  if (provider === "anthropic_console") return "Anthropic Console";
  if (provider === "openai") return "OpenAI";
  if (provider === "openrouter") return "OpenRouter";
  return "Gemini";
}
