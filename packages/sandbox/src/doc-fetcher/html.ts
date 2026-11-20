const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const RAW_TAGS = new Set(["script", "style", "noscript"]);

const DROP_TAGS = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "iframe",
  "object",
  "embed",
  "svg",
  "canvas",
  "form",
  "button",
  "input",
  "textarea",
  "select",
  "option",
  "link",
  "meta",
  "base",
  "head",
  "title",
]);

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export interface ElementNode {
  readonly type: "element";
  readonly name: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: Node[];
}

export interface TextNode {
  readonly type: "text";
  readonly value: string;
}

export type Node = ElementNode | TextNode;

interface StartToken {
  readonly type: "start";
  readonly name: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly selfClosing: boolean;
}

interface EndToken {
  readonly type: "end";
  readonly name: string;
}

type Token = StartToken | EndToken | TextNode;

export function parseHtml(html: string): ElementNode {
  return buildTree(tokenize(html));
}

export function extractVisibleText(html: string): string {
  return renderText(parseHtml(html).children, false).replace(/\s+/g, " ").trim();
}

export function htmlToMarkdown(html: string): string {
  return renderChildren(parseHtml(html).children).replace(/[ \t]+\n/g, "\n").trim();
}

export function isHiddenElement(element: ElementNode): boolean {
  const aria = element.attrs["aria-hidden"];
  if (aria !== undefined && aria.toLowerCase() === "true") return true;
  const hidden = element.attrs.hidden;
  if (hidden !== undefined && hidden.toLowerCase() !== "false") return true;
  const style = element.attrs.style;
  if (style !== undefined && styleDeclHides(style)) return true;
  return false;
}

export function walkElements(element: ElementNode, visit: (element: ElementNode) => void): void {
  if (isHiddenElement(element)) return;
  visit(element);
  for (const child of element.children) {
    if (child.type === "element") walkElements(child, visit);
  }
}

function styleDeclHides(style: string): boolean {
  const cleaned = style.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const part of cleaned.split(";")) {
    const colon = part.indexOf(":");
    if (colon < 0) continue;
    const prop = part.slice(0, colon).trim().toLowerCase();
    const value = normalizeCssValue(part.slice(colon + 1));
    if (prop === "display" && value === "none") return true;
    if (prop === "visibility" && value === "hidden") return true;
    if ((prop === "opacity" || prop === "font-size") && isZeroCss(value)) return true;
  }
  return false;
}

function normalizeCssValue(value: string): string {
  return value.replace(/\/\*[\s\S]*?\*\//g, "").replace(/!important/gi, "").trim().toLowerCase().replace(/\s+/g, "");
}

function isZeroCss(value: string): boolean {
  return /^(?:0+(?:\.0+)?|\.0+)(?:[a-z%]+)?$/.test(value);
}

function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < html.length) {
    if (html.startsWith("<!--", index)) {
      const end = html.indexOf("-->", index + 4);
      index = end < 0 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith("<!", index) || html.startsWith("<?", index)) {
      const end = html.indexOf(">", index + 2);
      index = end < 0 ? html.length : end + 1;
      continue;
    }
    if (html.startsWith("</", index)) {
      const end = html.indexOf(">", index + 2);
      const raw = html.slice(index + 2, end < 0 ? html.length : end);
      const name = raw.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
      if (name) tokens.push({ type: "end", name });
      index = end < 0 ? html.length : end + 1;
      continue;
    }
    const current = html[index] ?? "";
    const next = html[index + 1] ?? "";
    if (current === "<" && /[A-Za-z]/.test(next)) {
      const parsed = readStartTag(html, index);
      tokens.push(parsed.token);
      index = parsed.next;
      if (RAW_TAGS.has(parsed.token.name) && !parsed.token.selfClosing) {
        const closer = new RegExp(`</${parsed.token.name}\\s*>`, "i");
        const found = closer.exec(html.slice(index));
        index = found ? index + found.index + found[0].length : html.length;
        tokens.push({ type: "end", name: parsed.token.name });
      }
      continue;
    }
    const nextTag = html.indexOf("<", index);
    const end = nextTag < 0 ? html.length : nextTag;
    if (end > index) tokens.push({ type: "text", value: decodeEntities(html.slice(index, end)) });
    if (nextTag < 0) break;
    if (nextTag === index) {
      tokens.push({ type: "text", value: "<" });
      index += 1;
      continue;
    }
    index = nextTag;
  }
  return tokens;
}

function readStartTag(html: string, start: number): { token: StartToken; next: number } {
  let index = start + 1;
  while (index < html.length && /[A-Za-z0-9:_-]/.test(html[index] ?? "")) index += 1;
  const name = html.slice(start + 1, index).toLowerCase();
  const attrs: Record<string, string> = {};
  let selfClosing = false;
  while (index < html.length) {
    const ch = html[index] ?? "";
    if (ch === ">") {
      index += 1;
      break;
    }
    if (ch === "/") {
      selfClosing = true;
      index += 1;
      continue;
    }
    if (ch === " " || ch === "\n" || ch === "\r" || ch === "\t") {
      index += 1;
      continue;
    }
    const attrStart = index;
    while (index < html.length && !/[=\s/>]/.test(html[index] ?? "")) index += 1;
    const attrName = html.slice(attrStart, index).toLowerCase();
    let value = "";
    if ((html[index] ?? "") === "=") {
      index += 1;
      const quote = html[index] ?? "";
      if (quote === '"' || quote === "'") {
        const end = html.indexOf(quote, index + 1);
        value = html.slice(index + 1, end < 0 ? html.length : end);
        index = end < 0 ? html.length : end + 1;
      } else {
        const valueStart = index;
        while (index < html.length && !/[\s>]/.test(html[index] ?? "")) index += 1;
        value = html.slice(valueStart, index);
      }
    }
    if (attrName && !(attrName in attrs)) attrs[attrName] = decodeEntities(value);
  }
  return {
    token: {
      type: "start",
      name,
      attrs,
      selfClosing: selfClosing || VOID_TAGS.has(name),
    },
    next: index,
  };
}

function buildTree(tokens: readonly Token[]): ElementNode {
  const root: ElementNode = { type: "element", name: "#root", attrs: {}, children: [] };
  const stack: ElementNode[] = [root];
  for (const token of tokens) {
    const parent = stack[stack.length - 1] ?? root;
    if (token.type === "text") {
      if (token.value.length > 0) parent.children.push(token);
      continue;
    }
    if (token.type === "start") {
      const element: ElementNode = {
        type: "element",
        name: token.name,
        attrs: token.attrs,
        children: [],
      };
      parent.children.push(element);
      if (!token.selfClosing) stack.push(element);
      continue;
    }
    for (let depth = stack.length - 1; depth > 0; depth -= 1) {
      if (stack[depth]?.name === token.name) {
        stack.length = depth;
        break;
      }
    }
  }
  return root;
}

function renderChildren(nodes: readonly Node[]): string {
  let out = "";
  for (const node of nodes) {
    if (node.type === "text") out += stripKeptWhitespace(node.value);
    else out += renderElement(node);
  }
  return out;
}

function renderElement(element: ElementNode): string {
  if (isHiddenElement(element) || DROP_TAGS.has(element.name)) return "";
  if (element.name === "table") return renderTable(element);
  if (element.name === "pre") return renderPre(element);
  if (/^h[1-6]$/.test(element.name)) {
    const level = Number(element.name[1]);
    return `\n\n${"#".repeat(level)} ${renderChildren(element.children).trim()}\n\n`;
  }
  if (element.name === "ul") return renderList(element, false);
  if (element.name === "ol") return renderList(element, true);
  if (element.name === "blockquote") {
    const text = renderChildren(element.children).trim().split("\n").join("\n> ");
    return `\n\n> ${text}\n\n`;
  }
  if (element.name === "br") return "\n";
  if (element.name === "hr") return "\n\n---\n\n";
  if (element.name === "p") return `\n\n${renderChildren(element.children).trim()}\n\n`;
  if (element.name === "strong" || element.name === "b") {
    return `**${renderChildren(element.children).trim()}**`;
  }
  if (element.name === "em" || element.name === "i") return `*${renderChildren(element.children).trim()}*`;
  if (element.name === "code") return inlineCode(textContent(element.children, true));
  if (element.name === "a") return renderAnchor(element);
  if (element.name === "img") return stripInvisibleChars(element.attrs.alt ?? "").trim();
  if (
    element.name === "span" ||
    element.name === "abbr" ||
    element.name === "small" ||
    element.name === "sub" ||
    element.name === "sup" ||
    element.name === "kbd" ||
    element.name === "samp" ||
    element.name === "var" ||
    element.name === "time" ||
    element.name === "label" ||
    element.name === "font" ||
    element.name === "mark" ||
    element.name === "cite"
  ) {
    return renderChildren(element.children);
  }
  return `\n\n${renderChildren(element.children).trim()}\n\n`;
}

function renderAnchor(element: ElementNode): string {
  const text = renderChildren(element.children).trim();
  const href = element.attrs.href ? safeHref(element.attrs.href) : null;
  if (!href || text.length === 0) return text;
  return `[${text}](${href})`;
}

function renderList(element: ElementNode, ordered: boolean): string {
  const items = element.children.filter(
    (child): child is ElementNode => child.type === "element" && child.name === "li" && !isHiddenElement(child),
  );
  const lines = items.map((item, index) => {
    const text = renderChildren(item.children).trim().replace(/\n+/g, " ");
    return `${ordered ? `${index + 1}. ` : "- "}${text}`;
  });
  if (lines.length === 0) return "";
  return `\n\n${lines.join("\n")}\n\n`;
}

function renderTable(table: ElementNode): string {
  const rows = collectRows(table)
    .map((row) => cells(row))
    .filter((row) => row.length > 0);
  const header = rows[0];
  if (!header) return "";
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const pad = (row: readonly string[]): string => {
    const copy = [...row];
    while (copy.length < width) copy.push("");
    return `| ${copy.join(" | ")} |`;
  };
  const separator = `| ${Array.from({ length: width }, () => "---").join(" | ")} |`;
  const body = rows.slice(1).map((row) => pad(row));
  return `\n\n${[pad(header), separator, ...body].join("\n")}\n\n`;
}

function collectRows(table: ElementNode): ElementNode[] {
  const rows: ElementNode[] = [];
  const visit = (node: ElementNode): void => {
    for (const child of node.children) {
      if (child.type !== "element" || isHiddenElement(child)) continue;
      if (child.name === "tr") rows.push(child);
      else if (child.name === "thead" || child.name === "tbody" || child.name === "tfoot") visit(child);
    }
  };
  visit(table);
  return rows;
}

function cells(row: ElementNode): string[] {
  const out: string[] = [];
  for (const child of row.children) {
    if (child.type === "element" && (child.name === "th" || child.name === "td") && !isHiddenElement(child)) {
      out.push(renderChildren(child.children).trim().replace(/\|/g, "\\|").replace(/\n+/g, " "));
    }
  }
  return out;
}

function renderPre(element: ElementNode): string {
  const code = element.children.find(
    (child): child is ElementNode => child.type === "element" && child.name === "code",
  );
  const source = code ?? element;
  const lang = languageOf(source);
  const text = textContent(source.children, true).replace(/\n$/, "");
  return fence(text, lang);
}

function languageOf(element: ElementNode): string {
  const match = /(?:^|\s)(?:language|lang)-([A-Za-z0-9_+-]+)/.exec(element.attrs.class ?? "");
  return match?.[1] ?? "";
}

function fence(code: string, lang: string): string {
  let size = 3;
  for (const mark of code.match(/`+/g) ?? []) {
    if (mark.length >= size) size = mark.length + 1;
  }
  const tick = "`".repeat(size);
  return `\n\n${tick}${lang}\n${code}\n${tick}\n\n`;
}

function inlineCode(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return `\`${collapsed.replace(/`/g, "\\`")}\``;
}

function textContent(nodes: readonly Node[], preserve: boolean): string {
  let out = "";
  for (const node of nodes) {
    if (node.type === "text") out += preserve ? stripInvisibleChars(node.value) : stripKeptWhitespace(node.value);
    else if (!isHiddenElement(node) && !DROP_TAGS.has(node.name)) out += textContent(node.children, preserve);
  }
  return out;
}

function renderText(nodes: readonly Node[], preserve: boolean): string {
  return textContent(nodes, preserve);
}

function stripKeptWhitespace(value: string): string {
  return stripInvisibleChars(value).replace(/\s+/g, " ");
}

export function stripInvisibleChars(value: string): string {
  return value.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u{E0000}-\u{E007F}]/gu, "");
}

function safeHref(href: string): string | null {
  const trimmed = stripInvisibleChars(href).trim();
  if (trimmed.length === 0) return null;
  if (/^(?:javascript|data|vbscript):/i.test(trimmed)) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    if (trimmed.startsWith("//") || trimmed.includes("\\") || trimmed.includes("\0")) return null;
    return trimmed;
  }
  try {
    const url = new URL(trimmed);
    if (url.username !== "" || url.password !== "") return null;
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href;
  } catch {
    return null;
  }
}

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      return fromCodePoint(Number.parseInt(body.slice(2), 16), all);
    }
    if (body.startsWith("#")) return fromCodePoint(Number.parseInt(body.slice(1), 10), all);
    return NAMED_ENTITIES[body.toLowerCase()] ?? all;
  });
}

function fromCodePoint(codePoint: number, fallback: string): string {
  if (!Number.isInteger(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) return fallback;
  return String.fromCodePoint(codePoint);
}
