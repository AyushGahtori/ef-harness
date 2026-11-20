import { extractVisibleText } from "./html.js";
import { MIN_STATIC_TEXT_CHARS } from "./policy.js";

export function needsJsRender(html: string): boolean {
  if (extractVisibleText(html).length < MIN_STATIC_TEXT_CHARS) return true;
  const visibleMarkup = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  if (/<div\b[^>]*\bid\s*=\s*["']root["'][^>]*>\s*<\/div>/i.test(visibleMarkup)) return true;
  if (/<div\b[^>]*\bid\s*=\s*["']root["'][^>]*\/>/i.test(visibleMarkup)) return true;
  if (/<div\b[^>]*\bid\s*=\s*["'](?:app|root)["'][^>]*>\s*Loading\.\.\.\s*<\/div>/i.test(visibleMarkup)) return true;
  return nextDataHasEmptyMain(html);
}

function nextDataHasEmptyMain(html: string): boolean {
  const match = /<script\b[^>]*\bid\s*=\s*["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!match?.[1]) return false;
  try {
    const data = JSON.parse(match[1]) as unknown;
    const pageProps = readPageProps(data);
    const strings: string[] = [];
    collectStrings(pageProps, strings);
    return strings.join("").trim().length === 0;
  } catch {
    return true;
  }
}

function readPageProps(data: unknown): unknown {
  if (!data || typeof data !== "object") return {};
  const props = "props" in data ? data.props : undefined;
  if (!props || typeof props !== "object" || !("pageProps" in props)) return {};
  return props.pageProps;
}

function collectStrings(value: unknown, into: string[]): void {
  if (typeof value === "string") {
    into.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, into);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, into);
  }
}
