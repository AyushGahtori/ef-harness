/** Whitespace tokenizer. One word is one token, matching the paperwork ceiling. */
export function countTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function splitTokens(text: string, chunkSize: number): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const tokens = trimmed.split(/\s+/);
  if (chunkSize < 1) return [trimmed];
  const parts: string[] = [];
  for (let index = 0; index < tokens.length; index += chunkSize) {
    parts.push(tokens.slice(index, index + chunkSize).join(" "));
  }
  return parts;
}
