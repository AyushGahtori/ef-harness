/** UTF-16 code unit order. Stable across process locales. */
export function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** Deterministic whitespace tokenizer: one word is one token. */
export function countTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function words(count: number, stem = "word"): string {
  if (count <= 0) return "";
  const parts: string[] = [];
  for (let index = 0; index < count; index += 1) parts.push(`${stem}${index}`);
  return parts.join(" ");
}

export function takeTokens(text: string, max: number): string {
  if (max <= 0) return "";
  const trimmed = text.trim();
  if (!trimmed) return "";
  return trimmed.split(/\s+/).slice(0, max).join(" ");
}

export function formatTokenK(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  const scaled = Math.round(tokens / 100) / 10;
  return `${scaled.toFixed(1)}k`;
}

export function tokenIndexOf(text: string, needle: string): number {
  const index = text.indexOf(needle);
  if (index < 0) return -1;
  return countTokens(text.slice(0, index));
}
