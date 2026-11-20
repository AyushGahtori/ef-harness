import { QUOTE_MIN_ALIGNMENT_PERCENT, QUOTE_MIN_CHARS } from "./domain.js";
import { stripInvisibleUnicode } from "./doc-quarantine.js";

export type QuoteFlag = "verified" | "unverified_quote";

export type QuoteStatus =
  | "verified"
  | "unverified_quote"
  | "altered_keyword"
  | "fabricated_method"
  | "fabricated_flag"
  | "fabricated_version"
  | "quote_too_short";

export interface QuoteMatch {
  readonly accepted: boolean;
  readonly alignment: number;
  readonly flag: QuoteFlag;
  readonly status: QuoteStatus;
  readonly reason: string;
}

const POLARITY = new Set([
  "required",
  "optional",
  "must",
  "shall",
  "should",
  "may",
  "mandatory",
  "forbidden",
  "prohibited",
  "enabled",
  "disabled",
  "true",
  "false",
  "always",
  "never",
  "allow",
  "deny",
  "allowed",
  "denied",
  "supported",
  "unsupported",
  "sync",
  "async",
  "synchronous",
  "asynchronous",
  "nullable",
  "deprecated",
  "removed",
  "experimental",
  "stable",
]);

const OPPOSITES: ReadonlyMap<string, readonly string[]> = new Map([
  ["required", ["optional"]],
  ["optional", ["required"]],
  ["enabled", ["disabled"]],
  ["disabled", ["enabled"]],
  ["true", ["false"]],
  ["false", ["true"]],
  ["allow", ["deny"]],
  ["deny", ["allow"]],
  ["allowed", ["denied", "forbidden"]],
  ["denied", ["allowed"]],
  ["forbidden", ["allowed"]],
  ["supported", ["unsupported"]],
  ["unsupported", ["supported"]],
  ["always", ["never"]],
  ["never", ["always"]],
  ["sync", ["async"]],
  ["async", ["sync"]],
  ["synchronous", ["asynchronous"]],
  ["asynchronous", ["synchronous"]],
]);

export class TokenBasedQuoteMatcher {
  match(exactQuote: string, sourceText: string): QuoteMatch {
    const quote = exactQuote.trim();
    if (quote.length < QUOTE_MIN_CHARS) {
      return reject("quote_too_short", "quote is shorter than the 10 character minimum", 0);
    }
    const quoteTokens = tokenize(quote);
    const sourceTokens = tokenize(sourceText);
    if (quoteTokens.length === 0 || sourceTokens.length === 0) {
      return reject("unverified_quote", "quote tokens are absent from the fetched page", 0);
    }

    const fabricated = fabricatedToken(quoteTokens, sourceTokens);
    if (fabricated) return fabricated;

    const aligned = bestWindow(quoteTokens, sourceTokens);
    const polarity = polarityFlip(aligned.pairs);
    if (polarity) {
      return reject("altered_keyword", polarity, aligned.ratio);
    }
    if (!meetsAlignment(aligned.matches, quoteTokens.length)) {
      return reject(
        "unverified_quote",
        `token alignment ${aligned.ratio.toFixed(3)} is below ${QUOTE_MIN_ALIGNMENT_PERCENT}%`,
        aligned.ratio,
      );
    }
    return {
      accepted: true,
      alignment: aligned.ratio,
      flag: "verified",
      status: "verified",
      reason: "whitespace and punctuation normalized token sequence matches the fetched page",
    };
  }
}

function reject(status: Exclude<QuoteStatus, "verified">, reason: string, alignment: number): QuoteMatch {
  return {
    accepted: false,
    alignment,
    flag: "unverified_quote",
    status,
    reason,
  };
}

function tokenize(text: string): string[] {
  const stripped = stripInvisibleUnicode(text).normalize("NFKC");
  const tokens: string[] = [];
  for (const part of stripped.split(/\s+/)) {
    const token = part
      .replace(/^[^\p{L}\p{N}_$.@/-]+|[^\p{L}\p{N}_$.@/-]+$/gu, "")
      .replace(/\.+$/u, "");
    if (token.length > 0) tokens.push(token);
  }
  return tokens;
}

function fabricatedToken(quoteTokens: readonly string[], sourceTokens: readonly string[]): QuoteMatch | null {
  const sourceSet = new Set(sourceTokens);
  const sourceVersions = new Set(sourceTokens.map(versionOf).filter((item): item is string => item !== null));
  for (const token of quoteTokens) {
    if (isFlag(token) && !sourceSet.has(token)) {
      return reject("fabricated_flag", `flag ${token} is not in the fetched page`, 0);
    }
    const version = versionOf(token);
    if (version && !sourceVersions.has(version)) {
      return reject("fabricated_version", `version ${version} is not in the fetched page`, 0);
    }
    if (isMethodName(token) && !sourceSet.has(token)) {
      return reject("fabricated_method", `method ${token} is not in the fetched page`, 0);
    }
  }
  return null;
}

function isFlag(token: string): boolean {
  return /^--?[A-Za-z][\w.-]*$/.test(token);
}

function isMethodName(token: string): boolean {
  if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(token)) return true;
  return /^[a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*$/.test(token);
}

function versionOf(token: string): string | null {
  const match = /(?:^|@)v?(\d+\.\d+(?:\.\d+)*)$/.exec(token);
  return match?.[1] ?? null;
}

function bestWindow(
  quoteTokens: readonly string[],
  sourceTokens: readonly string[],
): { readonly matches: number; readonly ratio: number; readonly pairs: readonly (readonly [string, string])[] } {
  let bestMatches = 0;
  let bestPairs: (readonly [string, string])[] = [];
  const lastStart = sourceTokens.length - 1;
  for (let start = 0; start <= lastStart; start += 1) {
    let matches = 0;
    const pairs: (readonly [string, string])[] = [];
    for (let index = 0; index < quoteTokens.length; index += 1) {
      const quoteToken = quoteTokens[index] ?? "";
      const sourceToken = sourceTokens[start + index];
      if (sourceToken === undefined) {
        pairs.push([quoteToken, ""]);
        continue;
      }
      pairs.push([quoteToken, sourceToken]);
      if (quoteToken === sourceToken) matches += 1;
    }
    if (matches > bestMatches) {
      bestMatches = matches;
      bestPairs = pairs;
    }
  }
  return {
    matches: bestMatches,
    ratio: bestMatches / quoteTokens.length,
    pairs: bestPairs,
  };
}

function polarityFlip(pairs: readonly (readonly [string, string])[]): string | null {
  for (const [quoteToken, sourceToken] of pairs) {
    if (quoteToken === sourceToken) continue;
    const quoteKey = quoteToken.toLowerCase();
    const sourceKey = sourceToken.toLowerCase();
    if (!POLARITY.has(quoteKey) && !POLARITY.has(sourceKey)) continue;
    const opposites = OPPOSITES.get(quoteKey) ?? [];
    if (opposites.includes(sourceKey) || (POLARITY.has(quoteKey) && quoteKey !== sourceKey)) {
      return `altered keyword "${sourceToken}" to "${quoteToken}"`;
    }
  }
  return null;
}

function meetsAlignment(matches: number, total: number): boolean {
  return matches * 100 >= total * QUOTE_MIN_ALIGNMENT_PERCENT;
}
