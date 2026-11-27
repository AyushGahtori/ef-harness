/** Deterministic token estimate: four characters of trimmed text is one token. */
export function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.ceil(trimmed.length / 4);
}

export const CHUNK_TOKEN_MIN = 2000;
export const CHUNK_TOKEN_MAX = 4000;
export const CHUNK_OVERLAP_TOKENS = 200;
export const HIGH_PAGE_COUNT = 100;

export function textOfAboutTokens(tokens: number, sentence = "Orders stay on the same service day."): string {
  const unit = `${sentence} `;
  let text = "";
  while (estimateTokens(text) < tokens) {
    text += unit;
  }
  return text.trim();
}
