/** Whitespace tokenizer used as the rule-budget ceiling (1 word = 1 token). */
export const RULE_TOKEN_CEILING = 120;

export function countTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}
