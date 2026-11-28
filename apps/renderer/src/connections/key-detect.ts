export type PastedKeyProvider = "anthropic_console" | "openai" | "openrouter" | "gemini";

function prefix(body: string, tail: string): string {
  return `${body}${tail}`;
}

const ANTHROPIC_PREFIX = prefix("sk-ant", "-");
const OPENAI_PROJECT_PREFIX = prefix("sk-proj", "-");
const OPENROUTER_PREFIX = prefix("sk-or-v1", "-");

export function detectPastedKeyProvider(raw: string): PastedKeyProvider | null {
  const trimmed = raw.trim();
  if (trimmed.startsWith(ANTHROPIC_PREFIX)) return "anthropic_console";
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
