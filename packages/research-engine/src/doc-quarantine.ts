const INVISIBLE =
  /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\u3164\uFEFF\uFFA0]|\u{E0000}-\u{E007F}/gu;

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

const ALWAYS_HIDDEN = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "iframe",
  "object",
  "embed",
  "link",
  "meta",
  "instruction",
]);

export interface QuarantineMeta {
  readonly url: string;
  readonly fetchedAt: string;
  readonly pageVersion: string;
}

export interface QuarantineResult {
  readonly plainText: string;
  readonly wrappedDataBlock: string;
  readonly strippedHidden: boolean;
}

export function stripInvisibleUnicode(value: string): string {
  return value.replace(INVISIBLE, "");
}

export function quarantineWebDoc(htmlOrText: string, meta: QuarantineMeta): QuarantineResult {
  const looksLikeHtml = /<[a-z!/]/i.test(htmlOrText);
  const withoutDoctype = htmlOrText.replace(/<!doctype\b[^>]*>/gi, "");
  const withoutComments = looksLikeHtml ? stripComments(withoutDoctype) : withoutDoctype;
  const selectors = looksLikeHtml ? hiddenSelectors(extractStyleText(withoutComments)) : EMPTY_SELECTORS;
  const extracted = looksLikeHtml
    ? extractVisibleText(withoutComments, selectors)
    : { text: htmlOrText, strippedHidden: false };
  const decoded = decodeEntities(extracted.text);
  const plain = collapseWhitespace(stripInvisibleUnicode(decoded));
  const fenced = escapeDataFraming(plain);
  const wrappedDataBlock = [
    `<data trust="untrusted" source="research_engine" tools="none" url="${escapeAttr(meta.url)}" fetched="${escapeAttr(meta.fetchedAt)}" page_version="${escapeAttr(meta.pageVersion)}">`,
    fenced,
    "</data>",
  ].join("\n");
  return {
    plainText: fenced,
    wrappedDataBlock,
    strippedHidden: extracted.strippedHidden || fenced !== htmlOrText.trim(),
  };
}

export function escapeDataFraming(text: string): string {
  return text.replace(/<\/data/gi, "&lt;/data").replace(/<instruction/gi, "&lt;instruction");
}

function stripComments(html: string): string {
  let out = "";
  let index = 0;
  while (index < html.length) {
    const start = html.indexOf("<!--", index);
    if (start < 0) {
      out += html.slice(index);
      break;
    }
    out += html.slice(index, start);
    const end = html.indexOf("-->", start + 4);
    if (end < 0) break;
    index = end + 3;
  }
  return out;
}

function extractStyleText(html: string): string {
  const chunks: string[] = [];
  const pattern = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  for (const match of html.matchAll(pattern)) {
    if (match[1]) chunks.push(match[1]);
  }
  return chunks.join("\n");
}

interface HiddenSelectors {
  readonly classes: ReadonlySet<string>;
  readonly ids: ReadonlySet<string>;
  readonly elements: ReadonlySet<string>;
}

const EMPTY_SELECTORS: HiddenSelectors = {
  classes: new Set<string>(),
  ids: new Set<string>(),
  elements: new Set<string>(),
};

function hiddenSelectors(css: string): HiddenSelectors {
  const classes = new Set<string>();
  const ids = new Set<string>();
  const elements = new Set<string>();
  for (const block of css.split("}")) {
    const splitAt = block.indexOf("{");
    if (splitAt < 0) continue;
    const body = block.slice(splitAt + 1);
    if (!isHiddenCss(body)) continue;
    for (const raw of block.slice(0, splitAt).split(",")) {
      const selector = raw.trim();
      for (const classMatch of selector.matchAll(/\.([A-Za-z_-][\w-]*)/g)) {
        const className = classMatch[1];
        if (className) classes.add(className);
      }
      for (const idMatch of selector.matchAll(/#([A-Za-z_-][\w-]*)/g)) {
        const id = idMatch[1];
        if (id) ids.add(id);
      }
      const elementMatch = /^([a-z][\w-]*)/i.exec(selector);
      if (elementMatch?.[1] && !selector.startsWith(".") && !selector.startsWith("#")) {
        elements.add(elementMatch[1].toLowerCase());
      }
    }
  }
  return { classes, ids, elements };
}

function isHiddenCss(body: string): boolean {
  const css = body.toLowerCase().replace(/\s+/g, "");
  if (css.includes("display:none")) return true;
  if (css.includes("visibility:hidden")) return true;
  if (/(?:^|;)opacity:0(?:;|$)/.test(css)) return true;
  if (/font-size:0(?:px|pt|em|rem|%)?(?:;|$)/.test(css)) return true;
  if (css.includes("font-size:1pt")) return true;
  const whiteText = css.includes("color:#fff") || css.includes("color:#ffffff") || css.includes("color:white");
  const whiteBackground =
    css.includes("background:#fff") ||
    css.includes("background:#ffffff") ||
    css.includes("background:white") ||
    css.includes("background-color:#fff") ||
    css.includes("background-color:#ffffff") ||
    css.includes("background-color:white");
  return whiteText && whiteBackground;
}

interface ExtractedText {
  readonly text: string;
  readonly strippedHidden: boolean;
}

function extractVisibleText(html: string, selectors: HiddenSelectors): ExtractedText {
  const parts: string[] = [];
  const stack: { readonly name: string; readonly hidden: boolean }[] = [];
  let strippedHidden = false;
  const pattern = /<!--[\s\S]*?-->|<\/([A-Za-z][\w:-]*)\s*>|<([A-Za-z][\w:-]*)\b([^>]*)>|[^<]+/g;
  for (const match of html.matchAll(pattern)) {
    const raw = match[0] ?? "";
    if (raw.startsWith("<!--")) {
      strippedHidden = true;
      continue;
    }
    const closeName = match[1]?.toLowerCase();
    if (closeName) {
      for (let index = stack.length - 1; index >= 0; index -= 1) {
        const open = stack.pop();
        if (open?.hidden) strippedHidden = true;
        if (open?.name === closeName) break;
      }
      continue;
    }
    const openName = match[2];
    if (openName) {
      const name = openName.toLowerCase();
      const attrs = match[3] ?? "";
      const parentHidden = stack.some((frame) => frame.hidden);
      const selfHidden = parentHidden || tagIsHidden(name, attrs, selectors);
      if (selfHidden) strippedHidden = true;
      if (!isSelfClosing(name, attrs)) stack.push({ name, hidden: selfHidden });
      continue;
    }
    if (!stack.some((frame) => frame.hidden)) parts.push(raw);
  }
  return { text: parts.join(" "), strippedHidden };
}

function tagIsHidden(name: string, attrs: string, selectors: HiddenSelectors): boolean {
  if (ALWAYS_HIDDEN.has(name) || selectors.elements.has(name)) return true;
  if (/\shidden(?:\s|=|$)/i.test(` ${attrs}`) || /(?:^|\s)hidden(?:\s|=|$)/i.test(attrs)) return true;
  if (/\baria-hidden\s*=\s*["']?\s*true/i.test(attrs)) return true;
  if (/\btype\s*=\s*["']hidden["']/i.test(attrs)) return true;
  const classNames = readAttr(attrs, "class").split(/\s+/).filter((item) => item.length > 0);
  if (classNames.some((item) => selectors.classes.has(item) || item === "hidden" || item === "visually-hidden")) {
    return true;
  }
  const id = readAttr(attrs, "id");
  if (id && selectors.ids.has(id)) return true;
  const style = readAttr(attrs, "style");
  return style.length > 0 && isHiddenCss(style);
}

function isSelfClosing(name: string, attrs: string): boolean {
  return VOID_TAGS.has(name) || /\/\s*$/.test(attrs);
}

function readAttr(attrs: string, name: string): string {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i");
  const match = pattern.exec(attrs);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos|nbsp);/g, (entity, body: string) => {
    if (body === "amp") return "&";
    if (body === "lt") return "<";
    if (body === "gt") return ">";
    if (body === "quot") return '"';
    if (body === "apos") return "'";
    if (body === "nbsp") return " ";
    if (body.startsWith("#x")) return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    if (body.startsWith("#")) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    return entity;
  });
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function escapeAttr(value: string): string {
  return stripInvisibleUnicode(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
