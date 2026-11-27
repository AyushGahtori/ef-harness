import type { MutableCounts, SecretFinding } from "./types.js";
import { stripHiddenUnicode } from "./unicode.js";

const AUTH_HEADER_NAMES = [
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "x-csrf-token",
  "proxy-authorization",
] as const;

const SENSITIVE_KEY_NAMES = [
  "password",
  "token",
  "secret",
  "accesstoken",
  "refreshtoken",
  "apikey",
  "ssn",
  "creditcard",
  "cvv",
  "privatekey",
] as const;

function joined(...parts: readonly string[]): string {
  return parts.join("");
}

export function isAuthHeader(name: string): boolean {
  return (AUTH_HEADER_NAMES as readonly string[]).includes(name.trim().toLowerCase());
}

export function isCookieHeader(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return normalized === "cookie" || normalized === "set-cookie";
}

export function normalizeSensitiveKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isSensitiveKey(name: string): boolean {
  return (SENSITIVE_KEY_NAMES as readonly string[]).includes(normalizeSensitiveKey(name));
}

export function headerPlaceholder(name: string): string {
  return `[REDACTED:${name}]`;
}

export function fieldPlaceholder(name: string): string {
  return `[REDACTED:${name}]`;
}

function livePrefix(): string {
  return joined("sk", "_live_");
}

function testPrefix(): string {
  return joined("sk", "_test_");
}

function githubPrefix(): string {
  return joined("ghp", "_");
}

function awsPrefix(): string {
  return joined("AK", "IA");
}

function pemHeader(): string {
  return joined("-----", "BEGIN", " ", "PRIVATE KEY-----");
}

function pemFooter(): string {
  return joined("-----", "END", " ", "PRIVATE KEY-----");
}

function jwtPattern(): RegExp {
  return /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
}

function apiKeyPattern(): RegExp {
  const live = livePrefix();
  const test = testPrefix();
  const github = githubPrefix();
  const aws = awsPrefix();
  return new RegExp(
    `${escapeRegExp(live)}[A-Za-z0-9_]{4,}|${escapeRegExp(test)}[A-Za-z0-9_]{4,}|${escapeRegExp(github)}[A-Za-z0-9]{8,}|${escapeRegExp(aws)}[0-9A-Z]{16}`,
    "g",
  );
}

function pemPattern(): RegExp {
  const header = escapeRegExp(pemHeader());
  const footer = escapeRegExp(pemFooter());
  return new RegExp(`${header}[\\s\\S]{0,65536}?${footer}|${header}`, "g");
}

function connectionPattern(): RegExp {
  return /\b((?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|amqp|amqps):\/\/)([^/\s:@]+):([^/\s@]+)@/gi;
}

function authHeaderPattern(): RegExp {
  const names = AUTH_HEADER_NAMES.map((name) => name.replace(/-/g, "\\-")).join("|");
  return new RegExp(`(^|[^\\w-])(${names})(\\s*:\\s*)([^\\r\\n]+)`, "gi");
}

function assignmentPattern(): RegExp {
  return /(["']?)(password|passwd|secret|token|access_token|refresh_token|api_key|ssn|credit_card|cvv|private_key)\1(\s*[:=]\s*)(["'])([^"'\r\n]{1,})\4/gi;
}

function bareAssignmentPattern(): RegExp {
  return /(^|[?&\s{,])(password|passwd|secret|token|access_token|refresh_token|api_key|ssn|credit_card|cvv|private_key)(\s*[:=]\s*)(?!\[REDACTED:)([^\s&"',;}\]]+)/gi;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function noteSecretsInside(value: string, counts: MutableCounts): void {
  const jwt = value.match(jwtPattern());
  if (jwt) counts.jwtTokens += jwt.length;
  const keys = value.match(apiKeyPattern());
  if (keys) counts.apiKeys += keys.length;
  const pem = value.match(pemPattern());
  if (pem) counts.pemBlocks += pem.length;
  const urls = value.match(connectionPattern());
  if (urls) {
    for (const url of urls) {
      if (/^postgres/i.test(url)) counts.postgresUrls += 1;
      else counts.sensitiveFields += 1;
    }
  }
}

export function redactFreeText(input: string, counts: MutableCounts): string {
  let text = stripHiddenUnicode(input, counts);
  text = text.replace(pemPattern(), () => {
    counts.pemBlocks += 1;
    return "[REDACTED:PEM_PRIVATE_KEY]";
  });
  text = text.replace(connectionPattern(), (_match, scheme: string) => {
    if (/^postgres/i.test(scheme)) counts.postgresUrls += 1;
    else counts.sensitiveFields += 1;
    return `${scheme}[REDACTED_CREDENTIALS]@`;
  });
  text = text.replace(
    authHeaderPattern(),
    (_match, lead: string, name: string, separator: string, value: string) => {
      if (value.trimStart().startsWith("[REDACTED:")) return _match;
      if (isCookieHeader(name)) counts.authCookies += 1;
      else counts.authHeaders += 1;
      noteSecretsInside(value, counts);
      return `${lead}${name}${separator}${headerPlaceholder(name)}`;
    },
  );
  text = text.replace(jwtPattern(), () => {
    counts.jwtTokens += 1;
    return "[REDACTED:JWT]";
  });
  text = text.replace(apiKeyPattern(), () => {
    counts.apiKeys += 1;
    return "[REDACTED:API_KEY]";
  });
  text = text.replace(assignmentPattern(), (_match, quote: string, name: string, separator: string) => {
    counts.sensitiveFields += 1;
    const replacement = fieldPlaceholder(name);
    return `${quote}${name}${quote}${separator}${quote}${replacement}${quote}`;
  });
  text = text.replace(bareAssignmentPattern(), (_match, lead: string, name: string, separator: string) => {
    counts.sensitiveFields += 1;
    return `${lead}${name}${separator}${fieldPlaceholder(name)}`;
  });
  return text;
}

export function redactHeaderValue(name: string, value: string, counts: MutableCounts): string {
  const stripped = stripHiddenUnicode(value, counts);
  if (!isAuthHeader(name)) return redactFreeText(stripped, counts);
  if (isCookieHeader(name)) counts.authCookies += 1;
  else counts.authHeaders += 1;
  noteSecretsInside(stripped, counts);
  return headerPlaceholder(name);
}

interface ResidualRule {
  readonly ruleId: string;
  readonly label: string;
  readonly pattern: () => RegExp;
}

function residualRules(): readonly ResidualRule[] {
  return [
    { ruleId: "pem", label: "PEM_PRIVATE_KEY", pattern: pemPattern },
    { ruleId: "connection", label: "URL_CREDENTIALS", pattern: connectionPattern },
    { ruleId: "jwt", label: "JWT", pattern: jwtPattern },
    { ruleId: "api-key", label: "API_KEY", pattern: apiKeyPattern },
    {
      ruleId: "auth-header",
      label: "AUTH_HEADER",
      pattern: () =>
        new RegExp(
          `(?:${AUTH_HEADER_NAMES.map((name) => name.replace(/-/g, "\\-")).join("|")})\\s*:\\s*(?!\\[REDACTED:)\\S`,
          "i",
        ),
    },
    {
      ruleId: "sensitive-assignment",
      label: "SENSITIVE_FIELD",
      pattern: () =>
        /["']?(?:password|passwd|secret|token|access_token|refresh_token|api_key|ssn|credit_card|cvv|private_key)["']?\s*[:=]\s*(?!["']?\[REDACTED:)\S/i,
    },
  ];
}

/** First-pass scanner used by PacketSecurityRedactor. */
export function scanRedactorSecrets(text: string): SecretFinding[] {
  if (text.length === 0) return [];
  const findings: SecretFinding[] = [];
  for (const rule of residualRules()) {
    if (rule.pattern().test(text)) {
      findings.push({ ruleId: rule.ruleId, label: rule.label });
    }
  }
  return findings;
}
