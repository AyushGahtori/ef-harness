import type { MutableCounts } from "./types.js";

const BIDI_AND_INVISIBLE = new Set<number>([
  0x180e, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2060,
  0x2066, 0x2067, 0x2068, 0x2069, 0xfeff,
]);

/** Tags, supplementary private-use, bidi overrides, and zero-width stealth characters. */
export function stripHiddenUnicode(input: string, counts: MutableCounts): string {
  let output = "";
  for (const character of input) {
    const code = character.codePointAt(0) ?? 0;
    if (code >= 0xe0000 || BIDI_AND_INVISIBLE.has(code)) {
      counts.hiddenUnicode += 1;
      continue;
    }
    output += character;
  }
  return output;
}
