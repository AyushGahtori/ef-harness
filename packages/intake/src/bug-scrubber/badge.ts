import type { RedactionCounts } from "./types.js";

function plural(count: number, singular: string, pluralLabel: string): string {
  return `${count} ${count === 1 ? singular : pluralLabel}`;
}

function joinClauses(items: readonly string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0] ?? ""} and ${items[1] ?? ""}`;
  const head = items.slice(0, -1).join(", ");
  return `${head}, and ${items[items.length - 1] ?? ""}`;
}

/**
 * Non-sensitive counts only. Secret values never appear in the sentence.
 * Example: "Scrubbed 4 auth cookies, 2 JWT tokens, and 1 Postgres URL before saving"
 */
export function formatRedactionBadge(counts: RedactionCounts): string {
  const clauses: string[] = [];
  if (counts.authCookies > 0) clauses.push(plural(counts.authCookies, "auth cookie", "auth cookies"));
  if (counts.authHeaders > 0) clauses.push(plural(counts.authHeaders, "auth header", "auth headers"));
  if (counts.jwtTokens > 0) clauses.push(plural(counts.jwtTokens, "JWT token", "JWT tokens"));
  if (counts.apiKeys > 0) clauses.push(plural(counts.apiKeys, "API key", "API keys"));
  if (counts.postgresUrls > 0) {
    clauses.push(plural(counts.postgresUrls, "Postgres URL", "Postgres URLs"));
  }
  if (counts.pemBlocks > 0) clauses.push(plural(counts.pemBlocks, "private key", "private keys"));
  if (counts.sensitiveFields > 0) {
    clauses.push(plural(counts.sensitiveFields, "sensitive field", "sensitive fields"));
  }
  if (counts.emails > 0) clauses.push(plural(counts.emails, "email", "emails"));
  if (counts.phones > 0) clauses.push(plural(counts.phones, "phone number", "phone numbers"));
  if (counts.ips > 0) clauses.push(plural(counts.ips, "IP address", "IP addresses"));
  if (clauses.length === 0) return "Scrubbed 0 secrets before saving";
  return `Scrubbed ${joinClauses(clauses)} before saving`;
}
