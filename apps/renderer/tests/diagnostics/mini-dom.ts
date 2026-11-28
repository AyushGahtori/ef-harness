import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";

const HTML_NS = "http://www.w3.org/1999/xhtml";
const SVG_NS = "http://www.w3.org/2000/svg";
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

type MiniNode = MiniElement | MiniText | MiniDocument;

class NamedNodeMap {
  readonly length: number;
  constructor(entries: { name: string; value: string }[]) {
    this.length = entries.length;
    entries.forEach((entry, index) => {
      (this as unknown as Record<number, { name: string; value: string }>)[index] = entry;
    });
    this.entries = entries;
  }
  private readonly entries: { name: string; value: string }[];
  getNamedItem(name: string): { name: string; value: string } | null {
    return this.entries.find((entry) => entry.name === name) ?? null;
  }
  [Symbol.iterator](): IterableIterator<{ name: string; value: string }> {
    return this.entries[Symbol.iterator]();
  }
}

class MiniText {
  readonly nodeType = 3;
  readonly nodeName = "#text";
  readonly ELEMENT_NODE = 1;
  readonly TEXT_NODE = 3;
  readonly DOCUMENT_NODE = 9;
  parentNode: MiniElement | null = null;
  ownerDocument: MiniDocument | null = null;
  constructor(public data: string) {}
  get textContent(): string {
    return this.data;
  }
  get nodeValue(): string {
    return this.data;
  }
  get parentElement(): MiniElement | null {
    return this.parentNode;
  }
  get isConnected(): boolean {
    return this.ownerDocument !== null;
  }
}

class ClassList {
  private tokens: string[];
  constructor(value: string) {
    this.tokens = value.split(/\s+/).filter((token) => token.length > 0);
  }
  get length(): number {
    return this.tokens.length;
  }
  contains(name: string): boolean {
    return this.tokens.includes(name);
  }
  [Symbol.iterator](): IterableIterator<string> {
    return this.tokens[Symbol.iterator]();
  }
}

export class MiniElement {
  readonly nodeType = 1;
  readonly ELEMENT_NODE = 1;
  readonly TEXT_NODE = 3;
  readonly DOCUMENT_NODE = 9;
  readonly DOCUMENT_POSITION_DISCONNECTED = 1;
  readonly DOCUMENT_POSITION_PRECEDING = 2;
  readonly DOCUMENT_POSITION_FOLLOWING = 4;
  readonly DOCUMENT_POSITION_CONTAINS = 8;
  readonly DOCUMENT_POSITION_CONTAINED_BY = 16;
  parentNode: MiniNode | null = null;
  ownerDocument: MiniDocument | null = null;
  childNodes: MiniNode[] = [];
  attrs = new Map<string, string>();
  namespaceURI = HTML_NS;
  constructor(readonly localName: string) {}
  get tagName(): string {
    return this.namespaceURI === SVG_NS ? this.localName : this.localName.toUpperCase();
  }
  get nodeName(): string {
    return this.tagName;
  }
  get children(): MiniElement[] {
    return this.childNodes.filter((node): node is MiniElement => node.nodeType === 1);
  }
  get parentElement(): MiniElement | null {
    return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null;
  }
  get textContent(): string {
    return this.childNodes.map((node) => node.textContent).join("");
  }
  get innerText(): string {
    return this.textContent;
  }
  get id(): string {
    return this.getAttribute("id") ?? "";
  }
  get className(): string {
    return this.getAttribute("class") ?? "";
  }
  get classList(): ClassList {
    return new ClassList(this.className);
  }
  get isConnected(): boolean {
    return this.ownerDocument !== null;
  }
  get attributes(): NamedNodeMap {
    return new NamedNodeMap([...this.attrs.entries()].map(([name, value]) => ({ name, value })));
  }
  getAttribute(name: string): string | null {
    return this.attrs.get(name.toLowerCase()) ?? null;
  }
  hasAttribute(name: string): boolean {
    return this.attrs.has(name.toLowerCase());
  }
  hasAttributes(): boolean {
    return this.attrs.size > 0;
  }
  cloneNode(deep = false): MiniElement {
    const copy = new MiniElement(this.localName);
    copy.namespaceURI = this.namespaceURI;
    copy.ownerDocument = this.ownerDocument;
    for (const [key, value] of this.attrs) copy.setAttribute(key, value);
    if (deep) {
      for (const child of this.childNodes) {
        if (child.nodeType === 1) copy.appendChild(child.cloneNode(true));
        else copy.appendChild(new MiniText(child.textContent));
      }
    }
    return copy;
  }
  get firstChild(): MiniNode | null {
    return this.childNodes[0] ?? null;
  }
  get nextSibling(): MiniNode | null {
    return sibling(this, 1);
  }
  get previousSibling(): MiniNode | null {
    return sibling(this, -1);
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name.toLowerCase(), value);
  }
  get type(): string {
    return this.getAttribute("type") ?? "";
  }
  get checked(): boolean {
    return this.hasAttribute("checked");
  }
  get disabled(): boolean {
    return this.hasAttribute("disabled");
  }
  get htmlFor(): string {
    return this.getAttribute("for") ?? "";
  }
  get tabIndex(): number {
    const raw = this.getAttribute("tabindex");
    if (raw !== null) return Number(raw);
    if (this.localName === "a" || this.localName === "button" || this.localName === "input") return 0;
    return -1;
  }
  get offsetWidth(): number {
    return 120;
  }
  get offsetHeight(): number {
    return 24;
  }
  get clientWidth(): number {
    return 120;
  }
  get clientHeight(): number {
    return 24;
  }
  get scrollWidth(): number {
    return 120;
  }
  get scrollHeight(): number {
    return 24;
  }
  getBoundingClientRect(): { x: number; y: number; width: number; height: number; top: number; left: number; right: number; bottom: number } {
    return { x: 0, y: 0, width: 120, height: 24, top: 0, left: 0, right: 120, bottom: 24 };
  }
  getClientRects(): { x: number; y: number; width: number; height: number; top: number; left: number; right: number; bottom: number }[] {
    return [this.getBoundingClientRect()];
  }
  appendChild(node: MiniNode): MiniNode {
    node.parentNode = this;
    if (this.ownerDocument) assignDocument(node, this.ownerDocument);
    this.childNodes.push(node);
    return node;
  }
  matches(selector: string): boolean {
    return matchesSelector(this, selector);
  }
  closest(selector: string): MiniElement | null {
    if (this.matches(selector)) return this;
    const parent = this.parentElement;
    return parent ? parent.closest(selector) : null;
  }
  querySelector(selector: string): MiniElement | null {
    return queryAll(this, selector)[0] ?? null;
  }
  querySelectorAll(selector: string): NodeListLike {
    return nodeList(queryAll(this, selector));
  }
  getElementsByTagName(tag: string): NodeListLike {
    const wanted = tag.toLowerCase();
    return nodeList(descendants(this).filter((element) => wanted === "*" || element.localName === wanted));
  }
  contains(node: MiniNode): boolean {
    let current: MiniNode | null = node;
    while (current) {
      if (current === this) return true;
      current = current.parentNode;
    }
    return false;
  }
  compareDocumentPosition(other: MiniNode): number {
    return comparePosition(this, other);
  }
  get labels(): MiniElement[] {
    const id = this.id;
    if (!id || !this.ownerDocument) return [];
    return this.ownerDocument.getElementsByTagName("label").filter((label) => label.getAttribute("for") === id);
  }
}

class MiniDocument {
  readonly nodeType = 9;
  readonly nodeName = "#document";
  readonly ELEMENT_NODE = 1;
  readonly TEXT_NODE = 3;
  readonly DOCUMENT_NODE = 9;
  documentElement: MiniElement;
  defaultView: MiniWindow;
  readyState = "complete";
  compatMode = "CSS1Compat";
  contentType = "text/html";
  characterSet = "UTF-8";
  styleSheets: [] = [];
  constructor(window: MiniWindow) {
    this.defaultView = window;
    this.documentElement = new MiniElement("html");
    this.documentElement.ownerDocument = this;
    this.documentElement.parentNode = this;
  }
  get body(): MiniElement | null {
    return this.documentElement.children.find((element) => element.localName === "body") ?? null;
  }
  get head(): MiniElement | null {
    return this.documentElement.children.find((element) => element.localName === "head") ?? null;
  }
  get title(): string {
    return this.head?.getElementsByTagName("title")[0]?.textContent ?? "";
  }
  get documentURI(): string {
    return "https://diagnostics.local/health";
  }
  getElementById(id: string): MiniElement | null {
    return descendants(this.documentElement).find((element) => element.id === id) ?? null;
  }
  getElementsByTagName(tag: string): MiniElement[] {
    return [...this.documentElement.getElementsByTagName(tag)];
  }
  querySelector(selector: string): MiniElement | null {
    return this.documentElement.querySelector(selector);
  }
  querySelectorAll(selector: string): NodeListLike {
    return this.documentElement.querySelectorAll(selector);
  }
  createTreeWalker(root: MiniElement): { currentNode: MiniElement; nextNode: () => MiniElement | null } {
    const walker = {
      currentNode: root,
      nextNode(): MiniElement | null {
        const next = nextElement(walker.currentNode, root);
        if (!next) return null;
        walker.currentNode = next;
        return next;
      },
    };
    return walker;
  }
  createElement(tag: string): MiniElement {
    const element = new MiniElement(tag.toLowerCase());
    element.ownerDocument = this;
    return element;
  }
  implementation = {
    createHTMLDocument: (title: string): MiniDocument => {
      const created = new MiniDocument(this.defaultView);
      const html = created.createElement("html");
      const head = created.createElement("head");
      const body = created.createElement("body");
      const titleElement = created.createElement("title");
      titleElement.appendChild(new MiniText(title));
      head.appendChild(titleElement);
      html.appendChild(head);
      html.appendChild(body);
      html.ownerDocument = created;
      html.parentNode = created;
      created.documentElement = html;
      assignDocument(html, created);
      return created;
    },
  };
  compareDocumentPosition(other: MiniNode): number {
    return comparePosition(this, other);
  }
  contains(node: MiniNode): boolean {
    return this.documentElement === node || this.documentElement.contains(node);
  }
}

class MiniWindow {
  document: MiniDocument;
  Node = MiniElement;
  Element = MiniElement;
  HTMLElement = MiniElement;
  SVGElement = MiniElement;
  Document = MiniDocument;
  NodeList = class NodeList {};
  NamedNodeMap = NamedNodeMap;
  NodeFilter = { SHOW_ELEMENT: 1, SHOW_TEXT: 4, FILTER_ACCEPT: 1 };
  CSS = { escape: (value: string) => value, supports: () => false };
  navigator = { userAgent: "EFHarnessDiagnostics" };
  screen = { orientation: { angle: 0, type: "landscape-primary" }, width: 1280, height: 800 };
  location = { href: "https://diagnostics.local/health", pathname: "/health", protocol: "https:", host: "diagnostics.local" };
  innerWidth = 1280;
  innerHeight = 800;
  devicePixelRatio = 1;
  performance = { now: () => 0 };
  axe?: { run: (context?: unknown) => Promise<{ violations: { id: string; help: string; description: string; nodes: { html: string }[] }[] }> };
  constructor() {
    this.document = new MiniDocument(this);
  }
  getComputedStyle(element: MiniElement): ComputedStyle {
    return computedStyle(element);
  }
  getSelection(): null {
    return null;
  }
  requestAnimationFrame(callback: () => void): number {
    return setTimeout(callback, 0) as unknown as number;
  }
  cancelAnimationFrame(handle: number): void {
    clearTimeout(handle);
  }
  matchMedia(): { matches: boolean; media: string; addListener: () => void; removeListener: () => void; addEventListener: () => void; removeEventListener: () => void } {
    return {
      matches: false,
      media: "",
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
    };
  }
}

class ComputedStyle {
  constructor(private readonly element: MiniElement) {}
  getPropertyValue(name: string): string {
    const key = name.toLowerCase();
    const own = inlineStyle(this.element).get(key);
    if (own && own !== "transparent" && own !== "inherit") return own;
    if (key === "color" || key === "background-color" || key === "font-size" || key === "font-weight" || key === "font-variant-numeric") {
      const parent = this.element.parentElement;
      if (parent) return computedStyle(parent).getPropertyValue(key);
    }
    if (key === "color") return "#1b1f24";
    if (key === "background-color") return "#ffffff";
    if (key === "font-size") return "16px";
    if (key === "font-weight") return "400";
    if (key === "display") return displayOf(this.element);
    if (key === "visibility") return "visible";
    if (key === "opacity") return "1";
    if (key === "overflow" || key === "overflow-x" || key === "overflow-y") {
      return own ?? "visible";
    }
    return own ?? "";
  }
  get color(): string {
    return this.getPropertyValue("color");
  }
  get backgroundColor(): string {
    return this.getPropertyValue("background-color");
  }
  get fontSize(): string {
    return this.getPropertyValue("font-size");
  }
  get fontWeight(): string {
    return this.getPropertyValue("font-weight");
  }
  get display(): string {
    return this.getPropertyValue("display");
  }
  get visibility(): string {
    return this.getPropertyValue("visibility");
  }
}

interface NodeListLike extends Iterable<MiniElement> {
  length: number;
  item: (index: number) => MiniElement | null;
  forEach: (callback: (element: MiniElement, index: number) => void) => void;
  [index: number]: MiniElement;
  filter: (callback: (element: MiniElement) => boolean) => MiniElement[];
}

function sibling(node: MiniElement | MiniText, direction: 1 | -1): MiniNode | null {
  const parent = node.parentNode;
  if (!parent || parent.nodeType !== 1) return null;
  const index = parent.childNodes.indexOf(node);
  return parent.childNodes[index + direction] ?? null;
}

function nodeList(elements: MiniElement[]): NodeListLike {
  const list = {
    length: elements.length,
    item: (index: number) => elements[index] ?? null,
    forEach: (callback: (element: MiniElement, index: number) => void) => elements.forEach(callback),
    filter: (callback: (element: MiniElement) => boolean) => elements.filter(callback),
    [Symbol.iterator]: () => elements[Symbol.iterator](),
  } as NodeListLike;
  elements.forEach((element, index) => {
    list[index] = element;
  });
  return list;
}

function assignDocument(node: MiniNode, document: MiniDocument): void {
  if (node.nodeType === 9) return;
  node.ownerDocument = document;
  if (node.nodeType === 1) {
    for (const child of node.childNodes) assignDocument(child, document);
  }
}

function descendants(root: MiniElement): MiniElement[] {
  const all: MiniElement[] = [];
  const walk = (element: MiniElement): void => {
    for (const child of element.children) {
      all.push(child);
      walk(child);
    }
  };
  walk(root);
  return all;
}

function nextElement(current: MiniElement, root: MiniElement): MiniElement | null {
  const first = current.children[0];
  if (first) return first;
  let cursor: MiniElement | null = current;
  while (cursor && cursor !== root) {
    const parent: MiniElement | null = cursor.parentElement;
    if (!parent) return null;
    const siblings = parent.children;
    const index = siblings.indexOf(cursor);
    const next = siblings[index + 1];
    if (next) return next;
    cursor = parent;
  }
  return null;
}

function comparePosition(left: MiniNode, right: MiniNode): number {
  if (left === right) return 0;
  if (left.nodeType !== 9 && left.contains(right)) return 4 | 16;
  if (right.nodeType !== 9 && right.contains(left)) return 2 | 8;
  const leftOrder = orderOf(left);
  const rightOrder = orderOf(right);
  if (leftOrder === rightOrder) return 1;
  return leftOrder < rightOrder ? 4 : 2;
}

function orderOf(node: MiniNode): number {
  const document = node.nodeType === 9 ? node : node.ownerDocument;
  if (!document) return 0;
  const all = flatten(document.documentElement);
  const index = all.indexOf(node);
  return index < 0 ? 0 : index;
}

function flatten(element: MiniElement): MiniNode[] {
  const nodes: MiniNode[] = [element];
  for (const child of element.childNodes) {
    if (child.nodeType === 1) nodes.push(...flatten(child));
    else nodes.push(child);
  }
  return nodes;
}

function inlineStyle(element: MiniElement): Map<string, string> {
  const style = new Map<string, string>();
  const raw = element.getAttribute("style");
  if (!raw) return style;
  for (const part of raw.split(";")) {
    const index = part.indexOf(":");
    if (index < 0) continue;
    const key = part.slice(0, index).trim().toLowerCase();
    const value = part.slice(index + 1).trim();
    if (key) style.set(key, value);
  }
  return style;
}

function computedStyle(element: MiniElement): ComputedStyle {
  return new ComputedStyle(element);
}

function displayOf(element: MiniElement): string {
  const tag = element.localName;
  if (tag === "span" || tag === "a" || tag === "label" || tag === "button") return "inline";
  if (tag === "li") return "list-item";
  if (tag === "table") return "table";
  if (tag === "thead" || tag === "tbody") return "table-row-group";
  if (tag === "tr") return "table-row";
  if (tag === "td" || tag === "th") return "table-cell";
  if (tag === "caption") return "table-caption";
  return "block";
}

export function parseDocument(html: string): { window: MiniWindow; document: MiniDocument } {
  const window = new MiniWindow();
  const document = window.document;
  const root = parseFragment(html, document);
  const htmlElement = root.find((element) => element.localName === "html") ?? null;
  if (htmlElement) {
    htmlElement.ownerDocument = document;
    htmlElement.parentNode = document;
    document.documentElement = htmlElement;
    assignDocument(htmlElement, document);
  }
  return { window, document };
}

function parseFragment(html: string, document: MiniDocument): MiniElement[] {
  const roots: MiniElement[] = [];
  const stack: MiniElement[] = [];
  let index = 0;
  const parent = (): MiniElement | null => stack[stack.length - 1] ?? null;
  const add = (node: MiniNode): void => {
    const current = parent();
    if (current) current.appendChild(node);
    else if (node.nodeType === 1) roots.push(node);
  };
  while (index < html.length) {
    if (html.startsWith("<!DOCTYPE", index) || html.startsWith("<!doctype", index)) {
      const end = html.indexOf(">", index);
      index = end < 0 ? html.length : end + 1;
      continue;
    }
    if (html.startsWith("<!--", index)) {
      const end = html.indexOf("-->", index);
      index = end < 0 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith("</", index)) {
      const end = html.indexOf(">", index);
      const name = html.slice(index + 2, end < 0 ? html.length : end).trim().toLowerCase();
      index = end < 0 ? html.length : end + 1;
      for (let depth = stack.length - 1; depth >= 0; depth -= 1) {
        if (stack[depth]?.localName === name) {
          stack.length = depth;
          break;
        }
      }
      continue;
    }
    if (html.startsWith("<", index)) {
      const end = html.indexOf(">", index);
      const raw = html.slice(index + 1, end < 0 ? html.length : end).trim();
      index = end < 0 ? html.length : end + 1;
      const selfClosing = raw.endsWith("/");
      const [head, ...rest] = splitTag(raw.replace(/\/$/, "").trim());
      const name = (head ?? "div").toLowerCase();
      const element = new MiniElement(name);
      element.ownerDocument = document;
      const current = parent();
      if (current?.namespaceURI === SVG_NS || name === "svg") element.namespaceURI = SVG_NS;
      for (const attr of rest.join(" ").matchAll(/([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"']+)))?/g)) {
        const key = attr[1]?.toLowerCase();
        if (!key) continue;
        element.setAttribute(key, attr[2] ?? attr[3] ?? attr[4] ?? "");
      }
      add(element);
      if (!selfClosing && !VOID.has(name)) stack.push(element);
      continue;
    }
    const next = html.indexOf("<", index);
    const text = decodeEntities(html.slice(index, next < 0 ? html.length : next));
    index = next < 0 ? html.length : next;
    if (text.trim().length > 0) add(new MiniText(text));
  }
  return roots;
}

function splitTag(raw: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  for (const char of raw) {
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) parts.push(current);
  return parts;
}

function decodeEntities(text: string): string {
  return text
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

interface SimpleSelector {
  readonly kind: "universal" | "tag" | "id" | "class" | "attr" | "pseudo";
  readonly name: string;
  readonly op?: string;
  readonly value?: string;
  readonly inner?: SelectorList;
  readonly formula?: string;
}

interface CompoundSelector {
  readonly combinator: " " | ">" | "+" | "~";
  readonly simples: readonly SimpleSelector[];
}

type SelectorList = readonly (readonly CompoundSelector[])[];

function matchesSelector(element: MiniElement, selector: string): boolean {
  const list = parseSelectorList(selector);
  return list.some((chain) => matchesChain(element, chain));
}

function queryAll(root: MiniElement, selector: string): MiniElement[] {
  const list = parseSelectorList(selector);
  return [root, ...descendants(root)].filter((element) => list.some((chain) => matchesChain(element, chain)));
}

function matchesChain(element: MiniElement, chain: readonly CompoundSelector[]): boolean {
  const last = chain[chain.length - 1];
  if (!last || !matchCompound(element, last.simples)) return false;
  let cursor: MiniElement | null = element;
  for (let index = chain.length - 2; index >= 0; index -= 1) {
    const part = chain[index];
    const combinator = chain[index + 1]?.combinator ?? " ";
    if (!part || !cursor) return false;
    cursor = seek(cursor, combinator, part.simples);
    if (!cursor) return false;
  }
  return true;
}

function seek(element: MiniElement, combinator: " " | ">" | "+" | "~", simples: readonly SimpleSelector[]): MiniElement | null {
  if (combinator === ">") {
    const parent = element.parentElement;
    return parent && matchCompound(parent, simples) ? parent : null;
  }
  if (combinator === " ") {
    let parent = element.parentElement;
    while (parent) {
      if (matchCompound(parent, simples)) return parent;
      parent = parent.parentElement;
    }
    return null;
  }
  const parent = element.parentElement;
  if (!parent) return null;
  const siblings = parent.children;
  const index = siblings.indexOf(element);
  if (combinator === "+") {
    const previous = siblings[index - 1];
    return previous && matchCompound(previous, simples) ? previous : null;
  }
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const previous = siblings[cursor];
    if (previous && matchCompound(previous, simples)) return previous;
  }
  return null;
}

function matchCompound(element: MiniElement, simples: readonly SimpleSelector[]): boolean {
  return simples.every((simple) => matchSimple(element, simple));
}

function matchSimple(element: MiniElement, simple: SimpleSelector): boolean {
  if (simple.kind === "universal") return true;
  if (simple.kind === "tag") return element.localName === simple.name;
  if (simple.kind === "id") return element.id === simple.name;
  if (simple.kind === "class") return element.classList.contains(simple.name);
  if (simple.kind === "attr") return matchAttr(element, simple);
  if (simple.name === "not") return !(simple.inner ?? []).some((chain) => matchesChain(element, chain));
  if (simple.name === "is" || simple.name === "where") return (simple.inner ?? []).some((chain) => matchesChain(element, chain));
  if (simple.name === "root") return element.localName === "html";
  if (simple.name === "empty") return element.childNodes.every((node) => node.nodeType === 3 && node.textContent.trim() === "");
  if (simple.name === "checked") return element.checked;
  if (simple.name === "disabled") return element.disabled;
  if (simple.name === "enabled") return !element.disabled && ["button", "input", "select", "textarea"].includes(element.localName);
  if (simple.name === "link") return element.localName === "a" && element.hasAttribute("href");
  if (simple.name === "first-child") return siblingIndex(element) === 0;
  if (simple.name === "last-child") {
    const parent = element.parentElement;
    return parent ? siblingIndex(element) === parent.children.length - 1 : false;
  }
  if (simple.name === "nth-child") return matchesNth(siblingIndex(element) + 1, simple.formula ?? "n");
  if (simple.name === "first-of-type") return ofTypeIndex(element) === 0;
  if (simple.name === "last-of-type") {
    const same = (element.parentElement?.children ?? []).filter((child) => child.localName === element.localName);
    return same[same.length - 1] === element;
  }
  if (simple.name === "nth-of-type") return matchesNth(ofTypeIndex(element) + 1, simple.formula ?? "n");
  return false;
}

function matchAttr(element: MiniElement, simple: SimpleSelector): boolean {
  const actual = element.getAttribute(simple.name);
  if (actual === null) return false;
  if (!simple.op) return true;
  const expected = simple.value ?? "";
  if (simple.op === "=") return actual === expected;
  if (simple.op === "~=") return actual.split(/\s+/).includes(expected);
  if (simple.op === "^=") return actual.startsWith(expected);
  if (simple.op === "$=") return actual.endsWith(expected);
  if (simple.op === "*=") return actual.includes(expected);
  if (simple.op === "|=") return actual === expected || actual.startsWith(`${expected}-`);
  return false;
}

function siblingIndex(element: MiniElement): number {
  return element.parentElement?.children.indexOf(element) ?? 0;
}

function ofTypeIndex(element: MiniElement): number {
  const same = (element.parentElement?.children ?? []).filter((child) => child.localName === element.localName);
  return same.indexOf(element);
}

function matchesNth(position: number, formula: string): boolean {
  const text = formula.replaceAll(/\s+/g, "");
  if (text === "odd") return position % 2 === 1;
  if (text === "even") return position % 2 === 0;
  if (/^\d+$/.test(text)) return position === Number(text);
  const match = /^(?<a>-?\d*)n(?:(?<b>[+-]\d+))?$/.exec(text);
  if (!match) return false;
  const rawA = match.groups?.a ?? "";
  const a = rawA === "" || rawA === "+" ? 1 : rawA === "-" ? -1 : Number(rawA);
  const b = match.groups?.b ? Number(match.groups.b) : 0;
  if (a === 0) return position === b;
  const delta = position - b;
  return delta % a === 0 && delta / a >= 0;
}

function parseSelectorList(selector: string): SelectorList {
  return splitTop(selector, ",").map((part) => parseChain(part.trim())).filter((chain) => chain.length > 0);
}

function parseChain(selector: string): CompoundSelector[] {
  const chain: CompoundSelector[] = [];
  let index = 0;
  let combinator: CompoundSelector["combinator"] = " ";
  while (index < selector.length) {
    while (selector[index] === " " || selector[index] === "\n" || selector[index] === "\t") index += 1;
    if (index >= selector.length) break;
    const char = selector[index];
    if (char === ">" || char === "+" || char === "~") {
      combinator = char;
      index += 1;
      continue;
    }
    const start = index;
    const simples: SimpleSelector[] = [];
    while (index < selector.length && !", >+~".includes(selector[index] ?? "") && selector[index] !== " ") {
      simples.push(readSimple(selector, index).simple);
      index = readSimple(selector, index).next;
    }
    if (simples.length > 0) {
      chain.push({ combinator: chain.length === 0 ? " " : combinator, simples });
      combinator = " ";
    }
    if (index === start) index += 1;
  }
  return chain;
}

function readSimple(selector: string, index: number): { simple: SimpleSelector; next: number } {
  const char = selector[index];
  if (char === "*") return { simple: { kind: "universal", name: "*" }, next: index + 1 };
  if (char === "#") {
    const name = readIdent(selector, index + 1);
    return { simple: { kind: "id", name: name.value }, next: name.next };
  }
  if (char === ".") {
    const name = readIdent(selector, index + 1);
    return { simple: { kind: "class", name: name.value }, next: name.next };
  }
  if (char === "[") {
    const end = selector.indexOf("]", index);
    const body = selector.slice(index + 1, end < 0 ? selector.length : end).trim();
    const match = /^([^\s~|^$*!=]+)(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+)))?/.exec(body);
    return {
      simple: {
        kind: "attr",
        name: (match?.[1] ?? body).toLowerCase(),
        ...(match?.[2] ? { op: match[2], value: match[3] ?? match[4] ?? match[5] ?? "" } : {}),
      },
      next: end < 0 ? selector.length : end + 1,
    };
  }
  if (char === ":") {
    const name = readIdent(selector, selector[index + 1] === ":" ? index + 2 : index + 1);
    if (selector[name.next] === "(") {
      const close = findClose(selector, name.next);
      const inner = selector.slice(name.next + 1, close).trim();
      if (name.value.startsWith("nth")) {
        return { simple: { kind: "pseudo", name: name.value, formula: inner }, next: close + 1 };
      }
      return { simple: { kind: "pseudo", name: name.value, inner: parseSelectorList(inner) }, next: close + 1 };
    }
    return { simple: { kind: "pseudo", name: name.value }, next: name.next };
  }
  const name = readIdent(selector, index);
  return { simple: { kind: "tag", name: name.value.toLowerCase() }, next: name.next };
}

function readIdent(selector: string, index: number): { value: string; next: number } {
  let cursor = index;
  while (cursor < selector.length && /[A-Za-z0-9_-]/.test(selector[cursor] ?? "")) cursor += 1;
  return { value: selector.slice(index, cursor), next: cursor };
}

function findClose(selector: string, openIndex: number): number {
  let depth = 0;
  for (let index = openIndex; index < selector.length; index += 1) {
    if (selector[index] === "(") depth += 1;
    if (selector[index] === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return selector.length - 1;
}

function splitTop(selector: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";
  for (const char of selector) {
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "(" || char === "[") depth += 1;
    if (char === ")" || char === "]") depth -= 1;
    if (char === separator && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

export async function runAxe(html: string): Promise<{ violations: { id: string; help: string; description: string; nodes: { html: string }[] }[] }> {
  const dom = parseDocument(html);
  const sandbox = {
    window: dom.window,
    document: dom.document,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    performance,
    navigator: dom.window.navigator,
    Node: MiniElement,
    Element: MiniElement,
    HTMLElement: MiniElement,
    SVGElement: MiniElement,
    Document: MiniDocument,
    NodeFilter: dom.window.NodeFilter,
    getComputedStyle: (element: MiniElement) => dom.window.getComputedStyle(element),
    requestAnimationFrame: (callback: () => void) => dom.window.requestAnimationFrame(callback),
    cancelAnimationFrame: (handle: number) => dom.window.cancelAnimationFrame(handle),
    CSS: dom.window.CSS,
    MutationObserver: class {
      observe(): void {}
      disconnect(): void {}
      takeRecords(): [] {
        return [];
      }
    },
    Image: class {},
  };
  const context = createContext(sandbox);
  const axePath = fileURLToPath(new URL("../../../../node_modules/axe-core/axe.js", import.meta.url));
  runInContext(readFileSync(axePath, "utf8"), context, { filename: "axe.js" });
  const axe = dom.window.axe;
  if (!axe) throw new Error("axe-core did not attach to the diagnostics window");
  const root = dom.document.documentElement;
  return axe.run(root);
}
