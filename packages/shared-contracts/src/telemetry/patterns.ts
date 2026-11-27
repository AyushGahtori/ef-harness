import { escapeRegExp, joinParts } from "./util.js";

export interface SecretSpan {
  start: number;
  end: number;
  label: string;
}

export const SECRET_LABEL = {
  stripeLive: "SK_LIVE",
  stripeTest: "SK_TEST",
  anthropic: "ANTHROPIC_KEY",
  openaiProject: "OPENAI_PROJECT_KEY",
  openRouter: "OPENROUTER_KEY",
  google: "GOOGLE_API_KEY",
  github: "GITHUB_TOKEN",
  githubOauth: "GITHUB_OAUTH",
  githubFine: "GITHUB_FINE_GRAINED_PAT",
  aws: "AWS_ACCESS_KEY",
  pem: "PEM_PRIVATE_KEY",
  bearerJwt: "BEARER_JWT",
  urlBasicAuth: "URL_BASIC_AUTH",
  highEntropy: "HIGH_ENTROPY",
} as const;

const STRIPE_LIVE = joinParts(["sk", "_live_"]);
const STRIPE_TEST = joinParts(["sk", "_test_"]);
const ANTHROPIC = joinParts(["sk-ant", "-"]);
const OPENAI_PROJECT = joinParts(["sk-proj", "-"]);
const OPENROUTER = joinParts(["sk-or", "-v1-"]);
const GITHUB = joinParts(["ghp", "_"]);
const GITHUB_OAUTH = joinParts(["gho", "_"]);
const GITHUB_FINE = joinParts(["github", "_pat_"]);
const AWS = joinParts(["AK", "IA"]);
const BEGIN = "BEGIN";
const PRIVATE_KEY = "PRIVATE KEY";

const ASSIGNMENT_KEY =
  "password|passwd|secret|token|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|client[_-]?secret";
const ASSIGNMENT_OPERATOR = String.raw`(?:(?<![!=<>:])=(?!=)|(?<!:):(?!:))`;

interface CompiledPattern {
  source: string;
  flags: string;
  label: string;
  select?: (match: RegExpMatchArray) => { start: number; end: number } | undefined;
}

function fullMatch(match: RegExpMatchArray): { start: number; end: number } {
  const start = match.index ?? 0;
  return { start, end: start + match[0].length };
}

function prefixPattern(prefix: string, suffixSource: string, label: string): CompiledPattern {
  return {
    source: `(?<![A-Za-z0-9])${escapeRegExp(prefix)}${suffixSource}`,
    flags: "g",
    label,
  };
}

const PEM_KIND = "(?: RSA| DSA| EC| OPENSSH| ENCRYPTED)?";
const PEM_HEADER = `-----${BEGIN}${PEM_KIND} ${PRIVATE_KEY}-----`;
const PEM_FOOTER = `-----END${PEM_KIND} ${PRIVATE_KEY}-----`;

const PATTERNS: readonly CompiledPattern[] = [
  {
    source: `${PEM_HEADER}[\\s\\S]{0,65536}?${PEM_FOOTER}`,
    flags: "g",
    label: SECRET_LABEL.pem,
  },
  {
    source: PEM_HEADER,
    flags: "g",
    label: SECRET_LABEL.pem,
  },
  prefixPattern(STRIPE_LIVE, "[A-Za-z0-9]{16,}", SECRET_LABEL.stripeLive),
  prefixPattern(STRIPE_TEST, "[A-Za-z0-9]{16,}", SECRET_LABEL.stripeTest),
  prefixPattern(ANTHROPIC, "[A-Za-z0-9_\\-]{20,}", SECRET_LABEL.anthropic),
  prefixPattern(OPENAI_PROJECT, "[A-Za-z0-9_\\-]{20,}", SECRET_LABEL.openaiProject),
  prefixPattern(OPENROUTER, "[A-Za-z0-9]{20,}", SECRET_LABEL.openRouter),
  prefixPattern("AIza", "[0-9A-Za-z_\\-]{35}(?![0-9A-Za-z_\\-])", SECRET_LABEL.google),
  prefixPattern(GITHUB, "[A-Za-z0-9]{36}(?![A-Za-z0-9])", SECRET_LABEL.github),
  prefixPattern(GITHUB_OAUTH, "[A-Za-z0-9]{36}(?![A-Za-z0-9])", SECRET_LABEL.githubOauth),
  prefixPattern(GITHUB_FINE, "[A-Za-z0-9_]{22,}", SECRET_LABEL.githubFine),
  prefixPattern(AWS, "[0-9A-Z]{16}(?![0-9A-Z])", SECRET_LABEL.aws),
  {
    source: String.raw`\bBearer\s+eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}`,
    flags: "gi",
    label: SECRET_LABEL.bearerJwt,
  },
  {
    source: String.raw`\b([a-z][a-z0-9+.-]*:\/\/)([^\/\s:@]+):([^\/\s@]{8,})@`,
    flags: "gi",
    label: SECRET_LABEL.urlBasicAuth,
    select: urlCredentials,
  },
  {
    source: String.raw`(?:["'])?(?:${ASSIGNMENT_KEY})(?:["'])?\s*${ASSIGNMENT_OPERATOR}\s*(["'])([^"'\r\n]{20,})\1`,
    flags: "gi",
    label: SECRET_LABEL.highEntropy,
    select: (match) => quotedAssignment(match),
  },
  {
    source: String.raw`(?:["'])?(?:${ASSIGNMENT_KEY})(?:["'])?\s*${ASSIGNMENT_OPERATOR}\s*([^\s"'\\\`;,)}\]]{20,})`,
    flags: "gi",
    label: SECRET_LABEL.highEntropy,
    select: (match) => unquotedAssignment(match),
  },
];

function urlCredentials(match: RegExpMatchArray): { start: number; end: number } | undefined {
  const scheme = match[1];
  const user = match[2];
  const password = match[3];
  if (!scheme || !user || !password || password.length < 8) return undefined;
  const start = (match.index ?? 0) + scheme.length;
  return { start, end: start + user.length + 1 + password.length };
}

function quotedAssignment(match: RegExpMatchArray): { start: number; end: number } | undefined {
  const value = match[2];
  if (!value || !isHighEntropySecret(value)) return undefined;
  const start = (match.index ?? 0) + match[0].length - value.length - 1;
  if (start < (match.index ?? 0)) return undefined;
  return { start, end: start + value.length };
}

function unquotedAssignment(match: RegExpMatchArray): { start: number; end: number } | undefined {
  const value = match[1];
  if (!value || !isHighEntropySecret(value)) return undefined;
  const start = (match.index ?? 0) + match[0].length - value.length;
  return { start, end: start + value.length };
}

const PLACEHOLDER_MARKERS = [
  "replace_me",
  "changeme",
  "change_me",
  "your_api_key",
  "your-api-key",
  "placeholder",
  "example",
  "redacted",
  "password",
  "secret",
];

export function isHighEntropySecret(value: string): boolean {
  if (value.length < 20) return false;
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) return false;
  if (/^[0-9a-f]{40}$/i.test(value) || /^[0-9a-f]{64}$/i.test(value)) return false;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    return false;
  }
  const lowered = value.toLowerCase();
  for (const marker of PLACEHOLDER_MARKERS) {
    if (lowered.includes(marker)) return false;
  }
  if (sequentialRatio(value) > 0.6) return false;
  return shannonEntropy(value) >= 3.8;
}

function sequentialRatio(value: string): number {
  if (value.length < 2) return 0;
  let sequential = 0;
  for (let index = 1; index < value.length; index += 1) {
    const previous = value.charCodeAt(index - 1);
    const current = value.charCodeAt(index);
    if (Math.abs(current - previous) === 1) sequential += 1;
  }
  return sequential / (value.length - 1);
}

function shannonEntropy(value: string): number {
  const counts = new Map<string, number>();
  for (const character of value) {
    counts.set(character, (counts.get(character) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

function collect(text: string, pattern: CompiledPattern): SecretSpan[] {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const regex = new RegExp(pattern.source, flags);
  const spans: SecretSpan[] = [];
  for (const match of text.matchAll(regex)) {
    const range = pattern.select ? pattern.select(match) : fullMatch(match);
    if (!range || range.end <= range.start) continue;
    spans.push({ start: range.start, end: range.end, label: pattern.label });
  }
  return spans;
}

export function findBuiltinSecretSpans(text: string): SecretSpan[] {
  if (text.length === 0 || !mayContainBuiltinSecret(text)) return [];
  const spans: SecretSpan[] = [];
  for (const pattern of PATTERNS) {
    for (const span of collect(text, pattern)) spans.push(span);
  }
  return spans;
}

const PARTIAL_PREFIX_MARKERS: readonly { prefix: string; boundary: boolean }[] = [
  { prefix: STRIPE_LIVE, boundary: true },
  { prefix: STRIPE_TEST, boundary: true },
  { prefix: ANTHROPIC, boundary: true },
  { prefix: OPENAI_PROJECT, boundary: true },
  { prefix: OPENROUTER, boundary: true },
  { prefix: GITHUB, boundary: true },
  { prefix: GITHUB_OAUTH, boundary: true },
  { prefix: GITHUB_FINE, boundary: true },
  { prefix: AWS, boundary: true },
  { prefix: "AIza", boundary: true },
  { prefix: "Bearer ", boundary: true },
  { prefix: "bearer ", boundary: true },
  { prefix: `-----${BEGIN}`, boundary: false },
];

const PARTIAL_TOKEN_TAIL = new RegExp(
  `(?<![A-Za-z0-9])(?:${[
    `${escapeRegExp(STRIPE_LIVE)}[A-Za-z0-9]*`,
    `${escapeRegExp(STRIPE_TEST)}[A-Za-z0-9]*`,
    `${escapeRegExp(ANTHROPIC)}[A-Za-z0-9_-]*`,
    `${escapeRegExp(OPENAI_PROJECT)}[A-Za-z0-9_-]*`,
    `${escapeRegExp(OPENROUTER)}[A-Za-z0-9]*`,
    `${escapeRegExp(GITHUB)}[A-Za-z0-9]*`,
    `${escapeRegExp(GITHUB_OAUTH)}[A-Za-z0-9]*`,
    `${escapeRegExp(GITHUB_FINE)}[A-Za-z0-9_]*`,
    `${escapeRegExp(AWS)}[0-9A-Z]*`,
    `AIza[0-9A-Za-z_-]*`,
    `Bearer\\s+[A-Za-z0-9_.-]*`,
  ].join("|")})$`,
  "i",
);

const PARTIAL_URL_AUTH_TAIL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]*$/i;
const PARTIAL_QUOTED_ASSIGN_TAIL = new RegExp(
  `(?:["'])?(?:${ASSIGNMENT_KEY})(?:["'])?\\s*${ASSIGNMENT_OPERATOR}\\s*(["'])[^"'\\r\\n]*$`,
  "i",
);
const PARTIAL_UNQUOTED_ASSIGN_TAIL = new RegExp(
  `(?:["'])?(?:${ASSIGNMENT_KEY})(?:["'])?\\s*${ASSIGNMENT_OPERATOR}\\s*[^\\s"'\\\\\`;,)}\\]]+$`,
  "i",
);
const PARTIAL_PEM_HEADER_TAIL = new RegExp(`-----${BEGIN}${PEM_KIND}(?:\\s+(?:P(?:R(?:I(?:V(?:A(?:T(?:E(?:\\s+K(?:E(?:Y)?)?)?)?)?)?)?)?)?)?)?(?:-*)?$`);
const MAX_PARTIAL_LOOKBACK = 2048;

/**
 * Returns the earliest offset in `text` where an incomplete built-in secret
 * or prefix marker starts and extends to the end of `text`, so streaming
 * overlap slicing never splits a token before its minimum length is reached.
 */
export function findBuiltinPartialStart(text: string): number | undefined {
  if (text.length === 0) return undefined;
  let earliest: number | undefined;
  const record = (index: number) => {
    if (earliest === undefined || index < earliest) earliest = index;
  };

  const pemLookbackStart = Math.max(0, text.length - 65536);
  const pemTail = text.slice(pemLookbackStart);
  const pemIndex = pemTail.lastIndexOf(`-----${BEGIN}`);
  if (pemIndex >= 0) {
    const pemCandidate = pemTail.slice(pemIndex);
    if (!new RegExp(PEM_FOOTER).test(pemCandidate)) {
      record(pemLookbackStart + pemIndex);
    }
  }

  const lookbackStart = Math.max(0, text.length - MAX_PARTIAL_LOOKBACK);
  const tail = text.slice(lookbackStart);

  for (const regex of [
    PARTIAL_TOKEN_TAIL,
    PARTIAL_URL_AUTH_TAIL,
    PARTIAL_QUOTED_ASSIGN_TAIL,
    PARTIAL_UNQUOTED_ASSIGN_TAIL,
    PARTIAL_PEM_HEADER_TAIL,
  ]) {
    const match = regex.exec(tail);
    if (match && match.index !== undefined) {
      record(lookbackStart + match.index);
    }
  }

  for (const { prefix, boundary } of PARTIAL_PREFIX_MARKERS) {
    const maxLen = Math.min(prefix.length - 1, tail.length);
    for (let len = maxLen; len >= 1; len -= 1) {
      if (!tail.endsWith(prefix.slice(0, len))) continue;
      const startInTail = tail.length - len;
      const globalStart = lookbackStart + startInTail;
      if (boundary && globalStart > 0 && /[A-Za-z0-9]/.test(text[globalStart - 1] ?? "")) {
        continue;
      }
      record(globalStart);
      break;
    }
  }

  return earliest;
}

export function mayContainBuiltinSecret(text: string): boolean {
  if (
    text.includes("sk") ||
    text.includes("gh") ||
    text.includes("AIza") ||
    text.includes("AK") ||
    text.includes("eyJ") ||
    text.includes("BEGIN") ||
    text.includes("Bearer") ||
    text.includes("bearer") ||
    text.includes("://")
  ) {
    return true;
  }
  return /password|passwd|secret|token|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|client[_-]?secret/i.test(
    text,
  );
}
