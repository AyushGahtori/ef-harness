import { parseHtml, walkElements, type ElementNode } from "./html.js";

export function detectPageVersion(input: { readonly url?: string; readonly html?: string }): string | null {
  const found = input.html ? versionsInHtml(input.html) : { switcher: null, meta: null, heading: null };
  return found.switcher ?? found.meta ?? found.heading ?? (input.url ? versionFromUrl(input.url) : null);
}

export function versionFromUrl(url: string): string | null {
  let pathname = url;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url;
  }
  const patterns = [/\/v(\d+(?:\.\d+){0,2})(?:\/|$)/i, /\/docs\/(\d+(?:\.\d+){0,2})(?:\/|$)/i, /\/(\d+\.\d+(?:\.\d+)?)(?:\/|$)/];
  for (const pattern of patterns) {
    const match = pattern.exec(pathname);
    if (match?.[1]) return match[1];
  }
  return null;
}

function versionsInHtml(html: string): {
  switcher: string | null;
  meta: string | null;
  heading: string | null;
} {
  const found: { switcher: string | null; meta: string | null; heading: string | null } = {
    switcher: null,
    meta: null,
    heading: null,
  };
  walkElements(parseHtml(html), (element) => {
    if (found.switcher === null) {
      const switcher = versionFromSwitcher(element);
      if (switcher) found.switcher = switcher;
    }
    if (found.meta === null && element.name === "meta") {
      const name = (element.attrs.name ?? element.attrs.property ?? "").toLowerCase();
      if (name === "doc-version" || name === "version" || name === "doc:version") {
        found.meta = asVersion(element.attrs.content ?? "");
      }
    }
    if (found.heading === null && /^h[1-3]$/.test(element.name)) {
      found.heading = versionFromHeading(elementText(element));
    }
  });
  return found;
}

function versionFromSwitcher(element: ElementNode): string | null {
  const current = asVersion(element.attrs["data-current-version"] ?? element.attrs["data-doc-version"] ?? "");
  if (current) return current;
  if (element.name === "select" && namesVersion(element)) {
    const selected = element.children.find(
      (child): child is ElementNode =>
        child.type === "element" && child.name === "option" && child.attrs.selected !== undefined,
    );
    const option = selected ?? element.children.find((child): child is ElementNode => child.type === "element" && child.name === "option");
    if (option) return asVersion(option.attrs.value ?? "") ?? asVersion(elementText(option));
  }
  if (namesVersion(element)) {
    for (const child of element.children) {
      if (child.type !== "element") continue;
      const currentChild =
        child.attrs["aria-current"] !== undefined || child.attrs["aria-selected"]?.toLowerCase() === "true";
      if (!currentChild) continue;
      return asVersion(child.attrs["data-version"] ?? child.attrs.value ?? "") ?? asVersion(elementText(child));
    }
  }
  return null;
}

function namesVersion(element: ElementNode): boolean {
  const hint = `${element.attrs.id ?? ""} ${element.attrs.class ?? ""} ${element.attrs.name ?? ""} ${element.attrs["aria-label"] ?? ""}`;
  return /version/i.test(hint);
}

function versionFromHeading(text: string): string | null {
  const trimmed = text.replace(/\s+/g, " ").trim();
  const explicit = /\bversion\s+v?(\d+(?:\.\d+){0,2})\b/i.exec(trimmed);
  if (explicit?.[1]) return explicit[1];
  const prefixed = /\bv(\d+(?:\.\d+){0,2})\b/i.exec(trimmed);
  if (prefixed?.[1]) return prefixed[1];
  const product = /\b[A-Za-z][\w.+-]*(?:\s+[A-Za-z][\w.+-]*)*\s+(\d+(?:\.\d+){0,2})\b/.exec(trimmed);
  if (product?.[1]) return product[1];
  return null;
}

function asVersion(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const exact = /^v?(\d+(?:\.\d+){0,2})$/i.exec(trimmed);
  if (exact?.[1]) return exact[1];
  return versionFromHeading(trimmed);
}

function elementText(element: ElementNode): string {
  let out = "";
  for (const child of element.children) {
    if (child.type === "text") out += child.value;
    else out += elementText(child);
  }
  return out;
}
