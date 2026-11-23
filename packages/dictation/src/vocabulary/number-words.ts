const ONES: Readonly<Record<string, number>> = {
  zero: 0,
  oh: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const TENS: Readonly<Record<string, number>> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

export interface SpokenNumber {
  readonly value: number;
  readonly consumed: number;
}

export function normalizeSpokenWord(word: string): string {
  return word.normalize("NFC").toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/gu, "");
}

function isUnitDigit(word: string): boolean {
  const value = ONES[word];
  return value !== undefined && value >= 1 && value <= 9;
}

/** Parse a cardinal from 0 through 99, or a digit token, starting at `index`. */
export function parseSpokenNumber(words: readonly string[], index: number): SpokenNumber | null {
  const raw = words[index];
  if (raw === undefined) return null;
  const token = normalizeSpokenWord(raw);
  if (!token) return null;
  if (/^\d+$/.test(token)) {
    return { value: Number(token), consumed: 1 };
  }
  if (token.includes("-")) {
    const [tens, ones] = token.split("-");
    if (tens && ones && TENS[tens] !== undefined && isUnitDigit(ones)) {
      return { value: (TENS[tens] ?? 0) + (ONES[ones] ?? 0), consumed: 1 };
    }
    return null;
  }
  const tens = TENS[token];
  if (tens !== undefined) {
    const nextRaw = words[index + 1];
    const next = nextRaw === undefined ? "" : normalizeSpokenWord(nextRaw);
    if (isUnitDigit(next)) {
      return { value: tens + (ONES[next] ?? 0), consumed: 2 };
    }
    return { value: tens, consumed: 1 };
  }
  const ones = ONES[token];
  if (ones !== undefined) return { value: ones, consumed: 1 };
  return null;
}

export interface SpokenAgentNumber {
  readonly digits: string;
  readonly consumed: number;
}

function isZeroWord(word: string): boolean {
  return word === "zero" || word === "oh";
}

/**
 * Agent numbers keep spoken leading zeros (`zero zero fourteen` → `0014`)
 * and otherwise pad to 4 digits (`fourteen` → `0014`).
 */
export function parseSpokenAgentNumber(words: readonly string[], index: number): SpokenAgentNumber | null {
  let cursor = index;
  let leadingZeros = 0;
  while (cursor < words.length) {
    const token = normalizeSpokenWord(words[cursor] ?? "");
    if (!isZeroWord(token)) break;
    const next = cursor + 1 < words.length ? normalizeSpokenWord(words[cursor + 1] ?? "") : "";
    if (!next || (!isZeroWord(next) && parseSpokenNumber(words, cursor + 1) === null)) {
      break;
    }
    leadingZeros += 1;
    cursor += 1;
  }
  const parsed = parseSpokenNumber(words, cursor);
  if (!parsed) {
    if (leadingZeros === 0) return null;
    const width = Math.max(4, leadingZeros);
    return { digits: "0".repeat(width), consumed: leadingZeros };
  }
  const body = String(parsed.value);
  const width = Math.max(4, leadingZeros + body.length);
  return {
    digits: body.padStart(width, "0"),
    consumed: cursor - index + parsed.consumed,
  };
}
