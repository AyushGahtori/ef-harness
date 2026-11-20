import { BrandAssetError } from "./errors.js";
import { ALLOWED_XMLNS, DOMPURIFY_SVG_PROFILE, canonicalSvgTag } from "./svg-profile.js";

export interface SanitizedSvg {
  readonly svg: string;
  readonly profile: typeof DOMPURIFY_SVG_PROFILE;
  readonly removed: readonly string[];
  /** Exact audit line, for example `SanitizedSvgRemovedElements: ['script', 'external-image']`. */
  readonly removedElementsLog: string;
  readonly width: number;
  readonly height: number;
  readonly dominantColorsHex: readonly string[];
}

interface XmlElement {
  type: "element";
  name: string;
  attrs: Array<{ name: string; value: string }>;
  children: XmlNode[];
}

interface XmlText {
  type: "text";
  value: string;
}

type XmlNode = XmlElement | XmlText;

export function sanitizeSvgMarkup(input: string): SanitizedSvg {
  const removed: string[] = [];
  const seen = new Set<string>();
  const log = (token: string): void => {
    if (seen.has(token)) return;
    seen.add(token);
    removed.push(token);
  };
  const prepared = stripPrologue(input, log);
  let root: XmlElement;
  try {
    root = parseDocument(prepared, log);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new BrandAssetError("malformed-svg", message);
  }
  const cleaned = sanitizeElement(root, log);
  if (!cleaned || cleaned.name !== "svg") {
    throw new BrandAssetError("malformed-svg", "Sanitized SVG has no remaining svg root");
  }
  if (!cleaned.attrs.some((attr) => localName(attr.name).toLowerCase() === "xmlns")) {
    cleaned.attrs.push({ name: "xmlns", value: "http://www.w3.org/2000/svg" });
  }
  const svg = serialize(cleaned);
  if (hasDisallowedUrl(svg)) {
    throw new BrandAssetError("svg-external-ref", "Sanitized SVG still contains an external URL");
  }
  const size = readSvgSize(cleaned);
  return {
    svg,
    profile: DOMPURIFY_SVG_PROFILE,
    removed,
    removedElementsLog: formatRemovedLog(removed),
    width: size.width,
    height: size.height,
    dominantColorsHex: collectColors(svg),
  };
}

export function formatRemovedLog(removed: readonly string[]): string {
  return `SanitizedSvgRemovedElements: [${removed.map((token) => `'${token}'`).join(", ")}]`;
}

function stripPrologue(input: string, log: (token: string) => void): string {
  return stripDoctypes(input.replace(/^\uFEFF/, ""), log)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\?[\s\S]*?\?>/g, (pi) => {
      if (/https?:\/\//i.test(pi)) log("external-import");
      return "";
    });
}

function stripDoctypes(input: string, log: (token: string) => void): string {
  const lower = input.toLowerCase();
  let output = "";
  let index = 0;
  while (index < input.length) {
    const at = lower.indexOf("<!doctype", index);
    if (at < 0) return output + input.slice(index);
    output += input.slice(index, at);
    log("malformed-entity");
    index = endOfDoctype(input, at);
  }
  return output;
}

function endOfDoctype(input: string, start: number): number {
  let index = start + "<!doctype".length;
  let depth = 0;
  let quote = "";
  while (index < input.length) {
    const char = input.charAt(index);
    if (quote) {
      if (char === quote) quote = "";
      index += 1;
      continue;
    }
    if (char === `"` || char === "'") {
      quote = char;
    } else if (char === "[") {
      depth += 1;
    } else if (char === "]") {
      depth = Math.max(0, depth - 1);
    } else if (char === ">" && depth === 0) {
      return index + 1;
    }
    index += 1;
  }
  return input.length;
}

function parseDocument(input: string, log: (token: string) => void): XmlElement {
  const parser = new Parser(input, log);
  parser.skipSpace();
  if (!parser.startsWith("<")) {
    throw new BrandAssetError("malformed-svg", "SVG input is not an element");
  }
  const root = parser.parseElement();
  parser.skipSpace();
  if (!parser.eof()) {
    throw new BrandAssetError("malformed-svg", "SVG input has trailing markup");
  }
  return root;
}

class Parser {
  private index = 0;

  constructor(
    private readonly source: string,
    private readonly log: (token: string) => void,
  ) {}

  eof(): boolean {
    return this.index >= this.source.length;
  }

  startsWith(prefix: string): boolean {
    return this.source.startsWith(prefix, this.index);
  }

  skipSpace(): void {
    while (!this.eof() && /\s/u.test(this.source.charAt(this.index))) this.index += 1;
  }

  parseElement(): XmlElement {
    if (!this.startsWith("<") || this.startsWith("</")) {
      throw new BrandAssetError("malformed-svg", "Expected an opening tag");
    }
    this.index += 1;
    const name = this.readName();
    const attrs: Array<{ name: string; value: string }> = [];
    while (!this.eof()) {
      this.skipSpace();
      if (this.startsWith("/>")) {
        this.index += 2;
        return { type: "element", name, attrs, children: [] };
      }
      if (this.startsWith(">")) {
        this.index += 1;
        break;
      }
      const attrName = this.readName();
      this.skipSpace();
      let value = "";
      if (this.startsWith("=")) {
        this.index += 1;
        this.skipSpace();
        value = this.readValue();
      }
      attrs.push({ name: attrName, value });
    }
    const children: XmlNode[] = [];
    while (!this.eof()) {
      if (this.startsWith(`</`)) {
        this.index += 2;
        const closing = this.readName();
        if (closing.toLowerCase() !== name.toLowerCase()) {
          throw new BrandAssetError("malformed-svg", `Mismatched closing tag ${closing}`);
        }
        this.skipSpace();
        if (!this.startsWith(">")) throw new BrandAssetError("malformed-svg", "Unclosed tag");
        this.index += 1;
        return { type: "element", name, attrs, children };
      }
      if (this.startsWith("<![CDATA[")) {
        this.index += 9;
        const end = this.source.indexOf("]]>", this.index);
        if (end < 0) throw new BrandAssetError("malformed-svg", "Unclosed CDATA");
        children.push({ type: "text", value: this.source.slice(this.index, end) });
        this.index = end + 3;
        continue;
      }
      if (this.startsWith("<!--")) {
        const end = this.source.indexOf("-->", this.index + 4);
        if (end < 0) throw new BrandAssetError("malformed-svg", "Unclosed comment");
        this.index = end + 3;
        continue;
      }
      if (this.startsWith("<")) {
        children.push(this.parseElement());
        continue;
      }
      children.push({ type: "text", value: this.readText() });
    }
    throw new BrandAssetError("malformed-svg", `Unclosed element ${name}`);
  }

  private readName(): string {
    const start = this.index;
    while (!this.eof() && /[^\s=/>]/u.test(this.source.charAt(this.index))) this.index += 1;
    if (this.index === start) throw new BrandAssetError("malformed-svg", "Missing name");
    return this.source.slice(start, this.index);
  }

  private readValue(): string {
    const quote = this.source.charAt(this.index);
    if (quote === `"` || quote === "'") {
      this.index += 1;
      const start = this.index;
      const end = this.source.indexOf(quote, start);
      if (end < 0) throw new BrandAssetError("malformed-svg", "Unclosed attribute");
      this.index = end + 1;
      return decodeEntities(this.source.slice(start, end), this.log);
    }
    const start = this.index;
    while (!this.eof() && /[^\s>/]/u.test(this.source.charAt(this.index))) this.index += 1;
    return decodeEntities(this.source.slice(start, this.index), this.log);
  }

  private readText(): string {
    const start = this.index;
    while (!this.eof() && this.source.charAt(this.index) !== "<") this.index += 1;
    return decodeEntities(this.source.slice(start, this.index), this.log);
  }
}

function decodeEntities(value: string, log: (token: string) => void): string {
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    const current = value.charAt(index);
    if (current !== "&") {
      output += current;
      continue;
    }
    const semi = value.indexOf(";", index + 1);
    if (semi < 0 || semi - index > 32) {
      log("malformed-entity");
      continue;
    }
    const decoded = decodeEntityBody(value.slice(index + 1, semi));
    if (decoded === null) {
      log("malformed-entity");
      index = semi;
      continue;
    }
    output += decoded;
    index = semi;
  }
  return output;
}

function decodeEntityBody(body: string): string | null {
  const named: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: `"`, apos: "'" };
  if (Object.hasOwn(named, body)) return named[body] ?? null;
  const numeric = /^#(\d+)$/.exec(body) ?? /^#x([0-9a-f]+)$/i.exec(body);
  if (!numeric) return null;
  const raw = numeric[1];
  if (!raw) return null;
  const code = numeric[0].startsWith("#x") || numeric[0].startsWith("#X")
    ? Number.parseInt(raw, 16)
    : Number.parseInt(raw, 10);
  if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff) return null;
  if (code >= 0xd800 && code <= 0xdfff) return null;
  if (code < 32 && code !== 9 && code !== 10 && code !== 13) return null;
  return String.fromCodePoint(code);
}

function sanitizeElement(element: XmlElement, log: (token: string) => void): XmlElement | null {
  const local = localName(element.name).toLowerCase();
  if (local === "script") {
    log("script");
    return null;
  }
  if (local === "foreignobject") {
    log("foreignObject");
    return null;
  }
  const canonical = canonicalSvgTag(local);
  if (!canonical) {
    log(`disallowed:${local}`);
    return null;
  }
  const href = readHref(element);
  if (local === "image" && href && (isExternalReference(href) || isUnsafeImageData(href) || isScriptUrl(href))) {
    log(isScriptUrl(href) ? "javascript:" : "external-image");
    return null;
  }
  if (local === "use") {
    if (!href || !href.trim().startsWith("#") || isExternalReference(href) || isScriptUrl(href)) {
      log(isScriptUrl(href) ? "javascript:" : "external-use");
      return null;
    }
  }
  const attrs: Array<{ name: string; value: string }> = [];
  for (const attr of element.attrs) {
    const attrLocal = localName(attr.name).toLowerCase();
    if (attrLocal !== "orientation" && /^on[a-z]/i.test(attrLocal)) {
      log(attrLocal);
      continue;
    }
    let value = attr.value;
    if (attrLocal === "style") value = sanitizeStyle(value, log);
    if (isScriptUrl(value)) {
      log("javascript:");
      continue;
    }
    const xmlns = attrLocal === "xmlns" || attrLocal.startsWith("xmlns:");
    if (xmlns) {
      if (!ALLOWED_XMLNS.has(value.trim())) {
        log("external-import");
        continue;
      }
    } else if (isExternalReference(value)) {
      if (local === "image") {
        log("external-image");
        return null;
      }
      log(local === "use" ? "external-use" : "external-import");
      continue;
    }
    attrs.push({ name: attr.name, value });
  }
  const children: XmlNode[] = [];
  for (const child of element.children) {
    if (child.type === "text") {
      const value = canonical === "style" ? sanitizeStyle(child.value, log) : child.value;
      if (value) children.push({ type: "text", value });
      continue;
    }
    const nested = sanitizeElement(child, log);
    if (nested) children.push(nested);
  }
  return { type: "element", name: canonical, attrs, children };
}

function sanitizeStyle(css: string, log: (token: string) => void): string {
  let next = css;
  if (/@import/i.test(next)) {
    log("external-import");
    next = next.replace(/@import[^;]*;?/gi, "");
  }
  if (/javascript\s*:|expression\s*\(|-moz-binding|behavior\s*:/i.test(next)) {
    log("javascript:");
    next = next.replace(/javascript\s*:[^;}"']*/gi, "").replace(/expression\s*\([^)]*\)/gi, "");
  }
  if (/url\(\s*(['"]?)\s*(?:https?:|\/\/)/i.test(next)) {
    log("external-import");
    next = next.replace(/url\(\s*(['"]?)\s*(?:https?:|\/\/)[^)]*\)/gi, "none");
  }
  return next;
}

function readHref(element: XmlElement): string | null {
  for (const attr of element.attrs) {
    const name = localName(attr.name).toLowerCase();
    if (name === "href") return attr.value;
  }
  return null;
}

function isScriptUrl(value: string | null): boolean {
  if (!value) return false;
  const compact = value.replace(/[\u0000-\u0020]+/g, "").toLowerCase();
  return compact.startsWith("javascript:") || compact.startsWith("vbscript:");
}

function isExternalReference(value: string | null): boolean {
  if (!value) return false;
  const compact = value.replace(/[\u0000-\u0020]+/g, "");
  return /^(?:https?:|\/\/)/i.test(compact) || /https?:\/\//i.test(compact);
}

function isUnsafeImageData(value: string): boolean {
  const compact = value.replace(/[\u0000-\u0020]+/g, "").toLowerCase();
  return compact.startsWith("data:image/svg");
}

function localName(name: string): string {
  const split = name.split(":");
  return split.length > 1 ? (split[split.length - 1] ?? name) : name;
}

function hasDisallowedUrl(svg: string): boolean {
  const withoutNamespaces = svg
    .replaceAll("http://www.w3.org/2000/svg", "")
    .replaceAll("http://www.w3.org/1999/xlink", "")
    .replaceAll("http://www.w3.org/2000/xmlns/", "")
    .replaceAll("http://www.w3.org/XML/1998/namespace", "");
  return /https?:\/\//i.test(withoutNamespaces);
}

function readSvgSize(element: XmlElement): { width: number; height: number } {
  const viewBox = element.attrs.find((attr) => attr.name.toLowerCase() === "viewbox")?.value;
  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/u).map((part) => Number(part));
    const width = parts[2];
    const height = parts[3];
    if (width && height && width > 0 && height > 0) {
      return { width: Math.round(width), height: Math.round(height) };
    }
  }
  const width = numberAttr(element, "width");
  const height = numberAttr(element, "height");
  return { width: width ?? 256, height: height ?? 256 };
}

function numberAttr(element: XmlElement, name: string): number | null {
  const raw = element.attrs.find((attr) => attr.name === name)?.value ?? "";
  const match = /^(\d+(?:\.\d+)?)/.exec(raw.trim());
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return value > 0 ? Math.round(value) : null;
}

function collectColors(svg: string): string[] {
  const found = new Set<string>();
  for (const match of svg.matchAll(/#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
    const hex = match[0];
    if (!hex) continue;
    found.add(expandHex(hex).toUpperCase());
  }
  return [...found].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function expandHex(hex: string): string {
  if (hex.length === 4) {
    const r = hex.charAt(1);
    const g = hex.charAt(2);
    const b = hex.charAt(3);
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return hex;
}

function serialize(element: XmlElement): string {
  const attrs = [...element.attrs].sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  const rendered = attrs.map((attr) => `${attr.name}="${escapeAttr(attr.value)}"`).join(" ");
  const open = rendered ? `<${element.name} ${rendered}` : `<${element.name}`;
  if (element.children.length === 0) return `${open}/>`;
  const body = element.children.map((child) => (child.type === "text" ? escapeText(child.value) : serialize(child))).join("");
  return `${open}>${body}</${element.name}>`;
}

function escapeText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttr(value: string): string {
  return escapeText(value).replaceAll(`"`, "&quot;");
}
