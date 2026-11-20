import { truncateTokens, truncateUtf8, sha256Hex } from "./hash.js";
import { htmlToMarkdown, stripInvisibleChars } from "./html.js";
import { DEFAULT_MAX_OUTPUT_BYTES } from "./policy.js";

export interface SanitizeMeta {
  readonly url: string;
  readonly fetchedAt: string;
  readonly pageVersion: string;
  readonly maxBytes?: number;
  readonly maxTokens?: number;
}

export interface SanitizeResult {
  readonly markdown: string;
  readonly wrappedDataBlock: string;
  readonly truncated: boolean;
  readonly originalChars: number;
  readonly sha256: string;
}

export function sanitizeHtmlToQuotedMarkdown(html: string, meta: SanitizeMeta): SanitizeResult {
  return finishSanitized(htmlToMarkdown(html), meta);
}

export function sanitizeTextToQuotedMarkdown(text: string, meta: SanitizeMeta): SanitizeResult {
  const stripped = stripObviousHiddenMarkup(stripInvisibleChars(text));
  return finishSanitized(stripped, meta);
}

export function wrapUntrustedData(input: {
  readonly url: string;
  readonly fetchedAt: string;
  readonly pageVersion: string;
  readonly markdown: string;
}): string {
  return `<data source="doc_fetcher" url="${escapeAttr(input.url)}" fetched="${escapeAttr(input.fetchedAt)}" page_version="${escapeAttr(input.pageVersion)}" trust="untrusted">\n${input.markdown}\n</data>`;
}

export function escapeDataFraming(text: string): string {
  return text.replace(/<\/data/gi, "&lt;/data").replace(/<instruction/gi, "&lt;instruction");
}

function finishSanitized(markdown: string, meta: SanitizeMeta): SanitizeResult {
  const escaped = escapeDataFraming(stripInvisibleChars(markdown));
  const originalChars = escaped.length;
  let truncated = false;
  let body = escaped;
  if (meta.maxTokens !== undefined) {
    const tokens = truncateTokens(body, meta.maxTokens);
    body = tokens.text;
    truncated = truncated || tokens.truncated;
  }
  const bytes = truncateUtf8(body, meta.maxBytes ?? DEFAULT_MAX_OUTPUT_BYTES);
  body = bytes.text;
  truncated = truncated || bytes.truncated;
  const wrappedDataBlock = wrapUntrustedData({
    url: meta.url,
    fetchedAt: meta.fetchedAt,
    pageVersion: meta.pageVersion,
    markdown: body,
  });
  return {
    markdown: body,
    wrappedDataBlock,
    truncated,
    originalChars,
    sha256: sha256Hex(body),
  };
}

function escapeAttr(value: string): string {
  return stripInvisibleChars(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function stripObviousHiddenMarkup(text: string): string {
  const withoutRaw = text
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  if (!/style\s*=|aria-hidden\s*=/i.test(withoutRaw)) return withoutRaw;
  return htmlToMarkdown(withoutRaw);
}
