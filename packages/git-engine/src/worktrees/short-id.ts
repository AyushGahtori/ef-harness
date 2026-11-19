import { createHash } from "node:crypto";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Compact 6-character id derived from a stable hash. Defeats Windows path limits. */
export function compactShortId(input: string, length = 6): string {
  const digest = createHash("sha256").update(input).digest();
  let out = "";
  for (let index = 0; index < length; index += 1) {
    const byte = digest[index] ?? 0;
    const symbol = ALPHABET[byte % ALPHABET.length];
    out += symbol ?? "a";
  }
  return out;
}
