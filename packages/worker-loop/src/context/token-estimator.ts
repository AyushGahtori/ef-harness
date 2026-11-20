import type { ModelFamily, ModelProfile } from "./ports.js";
import type { TokenKind } from "./token-kinds.js";

export type { TokenKind } from "./token-kinds.js";

/**
 * Conservative chars-per-token in milli-units (2700 = 2.7 characters per token).
 * Lower ratios estimate more tokens. Local and compatible families are the
 * most conservative because their tokenizers vary.
 */
const CHARS_PER_TOKEN_MILLI: Record<ModelFamily, Record<TokenKind, number>> = {
  openai: { prose: 3500, code: 2700, json: 2900, mixed: 3000 },
  anthropic: { prose: 3400, code: 2600, json: 2800, mixed: 2900 },
  gemini: { prose: 3700, code: 3000, json: 3100, mixed: 3200 },
  openai_compatible: { prose: 3200, code: 2500, json: 2700, mixed: 2800 },
  local: { prose: 3000, code: 2400, json: 2500, mixed: 2600 },
};

const HEADROOM_PERCENT: Record<ModelFamily, number> = {
  openai: 8,
  anthropic: 8,
  gemini: 8,
  openai_compatible: 12,
  local: 12,
};

export class TokenEstimator {
  constructor(private readonly profile: Pick<ModelProfile, "family" | "contextWindow">) {}

  estimateText(text: string, kind: TokenKind = "mixed"): number {
    if (text.length === 0) return 0;
    const milli = CHARS_PER_TOKEN_MILLI[this.profile.family][kind];
    let tokens = Math.ceil((text.length * 1000) / milli);
    if (kind === "code" || kind === "mixed") {
      tokens += Math.ceil(countSymbols(text) / 6);
    }
    if (kind === "json") {
      tokens += countJsonStructure(text);
    }
    return tokens;
  }

  estimateJson(value: unknown): number {
    return this.estimateText(JSON.stringify(value), "json");
  }

  /**
   * Extra tokens held back so a tokenizer underestimate still compacts
   * before the provider returns context_overflow.
   */
  safetyHeadroom(contentTokens: number): number {
    const percent = HEADROOM_PERCENT[this.profile.family];
    return 32 + Math.ceil((contentTokens * percent) / 100);
  }

  estimateRequest(parts: readonly { readonly text: string; readonly kind: TokenKind }[]): number {
    let content = 0;
    for (const part of parts) content += this.estimateText(part.text, part.kind);
    return content + this.safetyHeadroom(content);
  }
}

function countSymbols(text: string): number {
  let count = 0;
  for (const char of text) {
    if ("{}[]()<>;:=|&*/\\".includes(char)) count += 1;
  }
  return count;
}

function countJsonStructure(text: string): number {
  let count = 0;
  for (const char of text) {
    if ("{}[]:,\"".includes(char)) count += 1;
  }
  return count;
}
