import type { ConnectionPin } from "./types.js";

/**
 * Provider desk pins. Color is never the only signal: each provider also has
 * a distinct pixel shape, and the hover tooltip repeats the provider name.
 */
export const CONNECTION_PINS = {
  chatgpt: {
    id: "chatgpt",
    label: "ChatGPT",
    color: "emerald",
    colorHex: "#1F8A5B",
    shape: "leaf",
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    color: "terracotta",
    colorHex: "#C4654A",
    shape: "bolt",
  },
  copilot: {
    id: "copilot",
    label: "Copilot",
    color: "sky",
    colorHex: "#3D9AD1",
    shape: "chip",
  },
  cursor: {
    id: "cursor",
    label: "Cursor",
    color: "indigo",
    colorHex: "#3F46B0",
    shape: "spark",
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    color: "amber",
    colorHex: "#D89A14",
    shape: "diamond",
  },
  "ollama-local": {
    id: "ollama-local",
    label: "Ollama Local",
    color: "slate",
    colorHex: "#5C6B7A",
    shape: "hex",
  },
  gemini: {
    id: "gemini",
    label: "Gemini",
    color: "cobalt",
    colorHex: "#1F4FA8",
    shape: "gem",
  },
} as const satisfies Record<string, ConnectionPin>;

const UNKNOWN_PIN: ConnectionPin = {
  id: "unknown",
  label: "Unknown",
  color: "slate",
  colorHex: "#5C6B7A",
  shape: "dot",
};

export function resolveConnection(raw: string): ConnectionPin {
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/[_/]+/g, " ")
    .replace(/\s+/g, " ");
  if (key.includes("ollama") || key.includes("lm studio")) return CONNECTION_PINS["ollama-local"];
  if (key.includes("chatgpt") || key.includes("openai")) return CONNECTION_PINS.chatgpt;
  if (key.includes("anthropic") || key.includes("claude")) return CONNECTION_PINS.anthropic;
  if (key.includes("copilot")) return CONNECTION_PINS.copilot;
  if (key.includes("cursor")) return CONNECTION_PINS.cursor;
  if (key.includes("openrouter")) return CONNECTION_PINS.openrouter;
  if (key.includes("gemini")) return CONNECTION_PINS.gemini;
  if (key.length === 0) return UNKNOWN_PIN;
  return {
    id: "unknown",
    label: raw.trim(),
    color: UNKNOWN_PIN.color,
    colorHex: UNKNOWN_PIN.colorHex,
    shape: UNKNOWN_PIN.shape,
  };
}
