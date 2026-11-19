/** Fixed token budget for `turn-summarizer@1` progress notes. */
export const TURN_SUMMARIZER_MAX_TOKENS = 400;

/** `cockpit-explainer@1` may return at most two sentences. */
export const COCKPIT_EXPLAINER_MAX_SENTENCES = 2;

/** Hard character cap so a sentence-light essay still fails closed. */
export const COCKPIT_EXPLAINER_MAX_CHARS = 500;

/**
 * Conservative token estimate (about 4 characters per token) used to enforce
 * the turn-summarizer cap without a model-specific tokenizer.
 */
export function estimatePromptTokens(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return Math.ceil(trimmed.length / 4);
}

/** Count sentences terminated by `.`, `!`, or `?` followed by whitespace or end. */
export function countSentences(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  const parts = trimmed.split(/(?<=[.!?])\s+/);
  let count = 0;
  for (const part of parts) {
    if (part.trim().length > 0) count += 1;
  }
  return count;
}
