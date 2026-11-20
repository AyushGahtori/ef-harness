/**
 * Quote normalization and infer-or-ask meaning guards.
 * Digits, currency symbols, and negation tokens are never discarded.
 */

const CURRENCY = new Set(["$", "£", "€", "¥", "¢", "₽", "₹", "₩", "฿"]);

const NEGATION_TOKENS: readonly { readonly token: string; readonly pattern: RegExp }[] = [
  { token: "don't", pattern: /\b(?:don't|don’t|dont)\b/gi },
  { token: "never", pattern: /\bnever\b/gi },
  { token: "without", pattern: /\bwithout\b/gi },
  { token: "not", pattern: /\bnot\b/gi },
  { token: "no", pattern: /\bno\b/gi },
  { token: "scrap", pattern: /\bscrap\b/gi },
];

const INJECTION_PATTERNS: readonly RegExp[] = [
  /mark all criteria explicit/i,
  /start build/i,
  /ignore (?:all |any )?(?:previous|prior|rules|instructions)/i,
  /<\s*\/?\s*instruction\b/i,
  /<\s*\/\s*data\b/i,
  /grant (?:me )?a tool/i,
  /authorize publication/i,
];

const COSTLY_KIND = new Set([
  "paid_service",
  "identity_provider",
  "data_retention",
  "data_deletion",
  "legal",
  "compliance",
  "legal_compliance",
]);

const COSTLY_ID =
  /(^|[._-])(paid|billing|payment|payments|identity|idp|retention|deletion|delete|legal|compliance|gdpr)([._-]|$)/i;

const POSITIONAL =
  /^(?:yes|use the (?:first|second|third|fourth) one|(?:first|second|third|fourth) one)$/;

export function foldWhitespace(input: string): string {
  return input
    .normalize("NFC")
    .replaceAll("’", "'")
    .replaceAll("‘", "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Collapse whitespace and drop punctuation that is not load-bearing.
 * Digits, in-number `:` / `.`, apostrophes, and currency symbols stay.
 */
export function normalizeQuoteForMatch(input: string): string {
  const folded = foldWhitespace(input);
  let out = "";
  for (let index = 0; index < folded.length; index += 1) {
    const ch = folded[index] ?? "";
    if (/[a-z0-9' ]/u.test(ch) || CURRENCY.has(ch)) {
      out += ch;
      continue;
    }
    const prev = folded[index - 1] ?? "";
    const next = folded[index + 1] ?? "";
    if ((ch === ":" || ch === ".") && /\d/u.test(prev) && /\d/u.test(next)) {
      out += ch;
    }
  }
  return out.replace(/ +/g, " ").trim();
}

export function extractDigitRuns(input: string): readonly string[] {
  return [...input.normalize("NFC").matchAll(/\d+(?:[:.]\d+)*/g)].map((match) => match[0] ?? "");
}

export function extractCurrencySymbols(input: string): readonly string[] {
  const symbols: string[] = [];
  for (const ch of input.normalize("NFC")) {
    if (CURRENCY.has(ch)) symbols.push(ch);
  }
  return symbols;
}

export function extractNegationTokens(input: string): readonly string[] {
  const folded = input.normalize("NFC").replaceAll("’", "'").replaceAll("‘", "'").toLowerCase();
  const found: { index: number; token: string }[] = [];
  for (const entry of NEGATION_TOKENS) {
    for (const match of folded.matchAll(entry.pattern)) {
      if (match.index !== undefined) found.push({ index: match.index, token: entry.token });
    }
  }
  found.sort((left, right) => left.index - right.index);
  return found.map((entry) => entry.token);
}

export function sameMultiset(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const counts = new Map<string, number>();
  for (const item of left) counts.set(item, (counts.get(item) ?? 0) + 1);
  for (const item of right) {
    const remaining = counts.get(item) ?? 0;
    if (remaining === 0) return false;
    counts.set(item, remaining - 1);
  }
  return true;
}

export function isPositionalAcceptance(quote: string): boolean {
  return POSITIONAL.test(normalizeQuoteForMatch(quote));
}

export function isInjectionQuote(quote: string): boolean {
  return INJECTION_PATTERNS.some((pattern) => pattern.test(quote));
}

export function isUncertaintyStatement(quote: string): boolean {
  const folded = normalizeQuoteForMatch(quote);
  return folded === "i don't know" || folded === "i do not know" || folded === "idk";
}

export function userConfirmsBaseline(quote: string): boolean {
  return /\b(keep|leave|stay|same as (?:the )?(?:code|repo)|as it is now|current behavior)\b/i.test(
    quote,
  );
}

export function negationGovernsValue(quote: string, value: string): boolean {
  const foldedQuote = foldWhitespace(quote);
  const foldedValue = foldWhitespace(value);
  if (!foldedValue) return false;
  if (extractNegationTokens(foldedValue).length > 0) return false;
  if (extractNegationTokens(foldedQuote).includes("scrap") && foldedQuote.includes(foldedValue)) return true;
  const valueIndex = foldedQuote.indexOf(foldedValue);
  if (valueIndex >= 0) {
    return extractNegationTokens(foldedQuote.slice(0, valueIndex)).length > 0;
  }
  const tokens = foldedValue.split(" ").filter((token) => token.length > 0);
  if (tokens.length === 0) return false;
  let cursor = 0;
  for (const token of tokens) {
    const at = foldedQuote.indexOf(token, cursor);
    if (at < 0) return extractNegationTokens(foldedQuote).length > 0;
    cursor = at + token.length;
  }
  const first = foldedQuote.indexOf(tokens[0] ?? "");
  return extractNegationTokens(foldedQuote.slice(0, Math.max(first, 0))).length > 0;
}

export function mentionsPhoneLink(quote: string): boolean {
  const folded = foldWhitespace(quote);
  if (!/\bphones?\b/.test(folded)) return false;
  return /\blink\b/.test(folded) || /\bmenu\b/.test(folded);
}

/** True when the quote is the phone-link claim and does not independently state another requirement. */
export function quoteIsPhoneLinkOnly(quote: string): boolean {
  if (!mentionsPhoneLink(quote)) return false;
  const folded = foldWhitespace(quote);
  return !/\b(offline|native|checkout|email|print|totals|salad|soup|manager|dish|dashboard)\b/.test(folded);
}

export function phoneClaimIsBroadened(quote: string, criterionId: string, value: string | null): boolean {
  if (!mentionsPhoneLink(quote)) return false;
  if (!phoneLinkForbids(criterionId, value)) return false;
  const folded = foldWhitespace(quote);
  const id = criterionId.toLowerCase();
  const written = (value ?? "").toLowerCase();
  if ((id.includes("offline") || written.includes("offline")) && !/\boffline\b/.test(folded)) return true;
  if ((id.includes("native") || written.includes("native")) && !/\bnative\b/.test(folded)) return true;
  if ((id.includes("checkout") || written.includes("checkout")) && !/\bcheckout\b/.test(folded)) return true;
  if (written.includes("whole product") || written.includes("entire product")) return true;
  if (id === "product.platform" || id === "product.client") return true;
  return false;
}

export function phoneLinkForbids(criterionId: string, value: string | null): boolean {
  const id = criterionId.toLowerCase();
  const written = (value ?? "").toLowerCase();
  if (id.includes("offline") || written.includes("offline")) return true;
  if (id.includes("native") || written.includes("native")) return true;
  if (id.includes("checkout") || written.includes("checkout")) return true;
  if (written.includes("whole product") || written.includes("entire product")) return true;
  if (id === "product.platform" || id === "product.client") return true;
  return false;
}

export function isMenuPhoneCriterion(criterionId: string, value: string | null): boolean {
  if (phoneLinkForbids(criterionId, value)) return false;
  const id = criterionId.toLowerCase();
  const written = (value ?? "").toLowerCase();
  const menuScoped =
    (id.includes("menu") && (id.includes("phone") || id.includes("mobile"))) ||
    id.includes("mobile_web") ||
    id.includes("phone_browser");
  if (!menuScoped) return false;
  if (!written) return true;
  return /phone|mobile web|mobile_web|browser|yes/.test(written);
}

export function quoteNamesRecipient(quote: string): boolean {
  const folded = foldWhitespace(quote);
  if (folded === "email" || folded === "email the totals") return false;
  return /\b(shift lead|recipient|manager|inbox|everyone|@|to the|to our)\b/.test(folded);
}

export function isEmailChannelQuote(quote: string): boolean {
  const folded = normalizeQuoteForMatch(quote);
  return folded === "email" || folded === "email the totals" || /\bemail\b/.test(folded);
}

export interface CostlyProbe {
  readonly id: string;
  readonly mustAsk?: boolean;
  readonly costly?: boolean;
  readonly hardToReverse?: boolean;
  readonly kind?: string;
}

export function forbidsDerivedBasis(criterion: CostlyProbe): boolean {
  if (criterion.mustAsk === true || criterion.costly === true || criterion.hardToReverse === true) {
    return true;
  }
  if (criterion.kind && COSTLY_KIND.has(criterion.kind)) return true;
  return COSTLY_ID.test(criterion.id);
}

export function delegationIsBounded(scope: string, limits: readonly string[]): boolean {
  if (limits.length === 0) return false;
  const unbounded = /^(anything|unlimited|whatever|no limit|unbounded)$/i;
  if (unbounded.test(scope.trim())) return false;
  return limits.some((limit) => !unbounded.test(limit.trim()));
}

export function valueWithinLimits(
  value: string,
  scope: string,
  limits: readonly string[],
): boolean {
  const wanted = value.trim().toLowerCase();
  if (!wanted) return false;
  if (scope.trim().toLowerCase() === wanted) return true;
  return limits.some((limit) => limit.trim().toLowerCase() === wanted);
}

export function inferTwoReadings(
  text: string,
): readonly { readonly id: string; readonly label: string }[] | null {
  if (/kitchen wants a printed list/i.test(text)) {
    return [
      { id: "add_print", label: "add print" },
      { id: "replace_email", label: "replace email" },
    ];
  }
  return null;
}

export function twoReadingsApplyToCriterion(criterionId: string): boolean {
  const id = criterionId.toLowerCase();
  return id.includes("print") || id.includes("delivery") || id.includes("channel");
}

export function sentenceStart(text: string, index: number): number {
  const slice = text.slice(0, index);
  const stops = [slice.lastIndexOf("."), slice.lastIndexOf("!"), slice.lastIndexOf("?"), slice.lastIndexOf("\n")];
  const boundary = Math.max(...stops);
  return boundary + 1;
}

export function governingNegationDropped(text: string, start: number, end: number): boolean {
  const prefix = text.slice(sentenceStart(text, start), start);
  if (extractNegationTokens(prefix).length === 0) return false;
  return extractNegationTokens(text.slice(start, end)).length === 0;
}

export function autoRetractedRanges(text: string): readonly { readonly start: number; readonly end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  for (const match of text.matchAll(/\bscrap\s+([a-z][a-z0-9-]*)/gi)) {
    const topic = match[1];
    const scrapAt = match.index ?? 0;
    if (!topic) continue;
    const topicPattern = new RegExp(`\\b${topic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    for (const hit of text.matchAll(topicPattern)) {
      const at = hit.index ?? 0;
      if (at < scrapAt) ranges.push({ start: at, end: at + (hit[0]?.length ?? 0) });
    }
  }
  return ranges;
}

export function rangesOverlap(
  start: number,
  end: number,
  range: { readonly start: number; readonly end: number },
): boolean {
  return start < range.end && range.start < end;
}

export function rangeContains(
  start: number,
  end: number,
  range: { readonly start: number; readonly end: number },
): boolean {
  return start >= range.start && end <= range.end;
}
