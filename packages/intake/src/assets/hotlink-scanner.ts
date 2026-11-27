import { existsSync, statSync } from "node:fs";
import path from "node:path";

export const HOTLINK_RULE_ID = "no-external-hotlink";

export const STOCK_IMAGE_HOSTS = [
  "unsplash.com",
  "imgur.com",
  "picsum.photos",
  "pexels.com",
  "placehold.co",
  "via.placeholder.com",
  "placekitten.com",
  "loremflickr.com",
  "dummyimage.com",
] as const;

export interface HotlinkFinding {
  readonly ruleId: typeof HOTLINK_RULE_ID;
  readonly line: number;
  readonly column: number;
  readonly url: string;
  readonly reason: "stock-cdn" | "unapproved-external" | "broken-relative-path";
  readonly message: string;
}

export interface HotlinkScanOptions {
  readonly projectRoot?: string;
  readonly approvedHosts?: readonly string[];
}

const IMAGE_ATTR = /<(?:img|image|source|video|use)\b[^>]*?\b(?:src|href|poster)\s*=\s*(['"])(.*?)\1/gi;
const SRCSET = /\bsrcset\s*=\s*(['"])(.*?)\1/gi;
const CSS_URL = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
const MARKDOWN_IMAGE = /!\[[^\]]*]\(\s*([^)\s]+)\s*\)/g;

export class ExternalHotlinkScanner {
  scan(source: string, options: HotlinkScanOptions = {}): HotlinkFinding[] {
    const findings: HotlinkFinding[] = [];
    const seen = new Set<string>();
    const push = (url: string, index: number, kind: "image" | "any"): void => {
      const finding = classify(url, index, source, options, kind);
      if (!finding) return;
      const key = `${finding.reason}:${finding.url}`;
      if (seen.has(key)) return;
      seen.add(key);
      findings.push(finding);
    };
    collect(source, IMAGE_ATTR, 2, (url, index) => push(url, index, "image"));
    collect(source, SRCSET, 2, (value, index) => {
      for (const part of value.split(",")) {
        const url = part.trim().split(/\s+/u)[0];
        if (url) push(url, index, "image");
      }
    });
    collect(source, CSS_URL, 2, (url, index) => push(url, index, "image"));
    collect(source, MARKDOWN_IMAGE, 1, (url, index) => push(url, index, "image"));
    for (const host of STOCK_IMAGE_HOSTS) {
      const needle = host.toLowerCase();
      let from = 0;
      const lower = source.toLowerCase();
      while (from < lower.length) {
        const at = lower.indexOf(needle, from);
        if (at < 0) break;
        const url = surroundingUrl(source, at) ?? host;
        push(url, at, "any");
        from = at + needle.length;
      }
    }
    return findings;
  }
}

export function scanUnapprovedHotlinks(source: string, options: HotlinkScanOptions = {}): HotlinkFinding[] {
  return new ExternalHotlinkScanner().scan(source, options);
}

function collect(
  source: string,
  pattern: RegExp,
  group: number,
  visit: (value: string, index: number) => void,
): void {
  pattern.lastIndex = 0;
  for (const match of source.matchAll(pattern)) {
    const value = match[group];
    if (!value || match.index === undefined) continue;
    visit(value, match.index);
  }
}

function classify(
  url: string,
  index: number,
  source: string,
  options: HotlinkScanOptions,
  kind: "image" | "any",
): HotlinkFinding | null {
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith("data:") || trimmed.startsWith("#")) return null;
  const position = positionOf(source, index);
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("//")) {
    const host = hostname(trimmed);
    if (!host) return null;
    const approved = options.approvedHosts ?? [];
    if (approved.some((item) => host === item.toLowerCase() || host.endsWith(`.${item.toLowerCase()}`))) {
      return null;
    }
    const stock = STOCK_IMAGE_HOSTS.some((item) => host === item || host.endsWith(`.${item}`));
    if (kind === "any" && !stock) return null;
    return {
      ruleId: HOTLINK_RULE_ID,
      line: position.line,
      column: position.column,
      url: trimmed,
      reason: stock ? "stock-cdn" : "unapproved-external",
      message: `Unapproved image hotlink ${trimmed}. Reference a typed local file from BRAND_ASSETS instead of a third-party CDN.`,
    };
  }
  if (kind !== "image" || options.projectRoot === undefined) return null;
  if (imagePathExists(options.projectRoot, trimmed)) return null;
  return {
    ruleId: HOTLINK_RULE_ID,
    line: position.line,
    column: position.column,
    url: trimmed,
    reason: "broken-relative-path",
    message: `Image path ${trimmed} does not exist in the project. Use a BRAND_ASSETS path that was emitted under public/brand or src/assets/brand.`,
  };
}

function hostname(url: string): string | null {
  try {
    return new URL(url.startsWith("//") ? `https:${url}` : url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function surroundingUrl(source: string, index: number): string | null {
  const slash = source.lastIndexOf("//", index);
  if (slash < 0 || index - slash > 80) return null;
  const http = source.lastIndexOf("http", slash);
  const start = http >= 0 && slash - http <= 6 ? http : slash;
  const match = /^(?:https?:)?\/\/[^\s"'<>)]+/i.exec(source.slice(start));
  return match?.[0] ?? null;
}

function imagePathExists(projectRoot: string, raw: string): boolean {
  const clean = (raw.split("?")[0] ?? raw).split("#")[0] ?? raw;
  const relative = clean.replace(/^\.\//, "");
  const candidates = clean.startsWith("/")
    ? [path.join(projectRoot, "public", clean.slice(1)), path.join(projectRoot, clean.slice(1))]
    : [
      path.join(projectRoot, relative),
      path.join(projectRoot, "public", relative),
      path.join(projectRoot, "src", relative),
    ];
  return candidates.some((candidate) => {
    if (!existsSync(candidate)) return false;
    return statSync(candidate).isFile();
  });
}

function positionOf(source: string, index: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let cursor = 0; cursor < index && cursor < source.length; cursor += 1) {
    if (source.charAt(cursor) === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}
