import { createRequire } from "node:module";
import { Buffer } from "node:buffer";
import { assembleDocument } from "./assemble.js";
import { UnsupportedOrMismatchedFileType } from "./errors.js";
import type { ConverterWarning, NormalizedDocument, RawBlock } from "./types.js";
import { buildZip, readZip } from "./zip-package.js";

interface MammothApi {
  convertToHtml(
    input: { buffer: Buffer },
    options?: { externalFileAccess?: boolean },
  ): Promise<{ value: string; messages: Array<{ type: string; message: string }> }>;
}

interface XmlElement {
  readonly name: string;
  readonly attrs: string;
  readonly children: (XmlElement | string)[];
}

const require = createRequire(import.meta.url);

function loadMammoth(): MammothApi | null {
  try {
    const loaded: unknown = require("mammoth");
    if (!loaded || typeof loaded !== "object" || !("convertToHtml" in loaded)) return null;
    const convertToHtml = loaded.convertToHtml;
    if (typeof convertToHtml !== "function") return null;
    return loaded as MammothApi;
  } catch {
    return null;
  }
}

export class DocxConverter {
  async convert(bytes: Uint8Array, fileName: string, sourceHash: string): Promise<{
    readonly document: NormalizedDocument;
    readonly engines: readonly string[];
  }> {
    const entries = readZip(bytes);
    const warnings: ConverterWarning[] = [];
    const engines = ["ooxml"];
    let xxeBlocked = false;
    let macrosStripped = false;
    const repacked: Array<{ name: string; data: Uint8Array }> = [];
    let documentXml = "";
    for (const entry of entries) {
      const lower = entry.name.replaceAll("\\", "/").toLowerCase();
      if (lower.endsWith("vbaproject.bin") || lower.includes("/vba/")) {
        macrosStripped = true;
        continue;
      }
      const asText = looksLikeXml(entry.data) ? Buffer.from(entry.data).toString("utf8") : null;
      if (asText !== null) {
        const sanitized = sanitizeOfficeXml(asText);
        if (sanitized.xxeBlocked) xxeBlocked = true;
        const encoded = Buffer.from(sanitized.xml, "utf8");
        repacked.push({ name: entry.name, data: encoded });
        if (lower === "word/document.xml") documentXml = sanitized.xml;
      } else {
        repacked.push({ name: entry.name, data: entry.data });
      }
    }
    if (!documentXml) {
      throw new UnsupportedOrMismatchedFileType("ZIP archive does not contain a DOCX word/document.xml part.");
    }
    if (xxeBlocked) {
      warnings.push({
        name: "XxeBlockedWarning",
        code: "xxe_blocked",
        message: "XML external entities were removed before DOCX parsing.",
      });
    }
    if (macrosStripped) {
      warnings.push({
        name: "MacrosStrippedWarning",
        code: "macros_stripped",
        message: "DOCX macros were stripped before parsing.",
      });
    }
    const mammoth = loadMammoth();
    if (mammoth) {
      try {
        await mammoth.convertToHtml(
          { buffer: Buffer.from(buildZip(repacked)) },
          { externalFileAccess: false },
        );
        engines.push("mammoth");
      } catch (error) {
        if (!xxeBlocked) throw error;
      }
    }
    const blocks = blocksFromDocumentXml(documentXml);
    return {
      engines,
      document: assembleDocument({
        sourceHash,
        fileName,
        mediaType: "docx",
        blocks,
        warnings,
        ocrDerived: false,
        stats: {},
      }),
    };
  }
}

export function sanitizeOfficeXml(xml: string): { readonly xml: string; readonly xxeBlocked: boolean } {
  const xxeBlocked = /<!DOCTYPE|<!ENTITY/i.test(xml);
  const withoutDoctype = xml
    .replace(/<!DOCTYPE\s+[^>[]*\[[\s\S]*?\]\s*>/gi, "")
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<!ENTITY[\s\S]*?>/gi, "");
  const xmlText = withoutDoctype.replace(
    /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)[A-Za-z_][\w.:-]*;/g,
    "",
  );
  return { xml: xmlText, xxeBlocked };
}

function looksLikeXml(bytes: Uint8Array): boolean {
  const sample = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 200))).toString("utf8").trimStart();
  return sample.startsWith("<?xml") || sample.startsWith("<");
}

function blocksFromDocumentXml(xml: string): RawBlock[] {
  const root = parseXml(xml);
  const blocks: RawBlock[] = [];
  let paragraphIndex = 0;
  let sectionHeading = "";
  const visit = (element: XmlElement, tableCell: readonly [number, number] | null): void => {
    const name = localName(element.name);
    if (name === "tbl") {
      let row = 0;
      for (const child of element.children) {
        if (typeof child === "string" || localName(child.name) !== "tr") continue;
        let col = 0;
        for (const cell of child.children) {
          if (typeof cell === "string" || localName(cell.name) !== "tc") continue;
          visit(cell, [row, col]);
          col += 1;
        }
        row += 1;
      }
      return;
    }
    if (name === "p") {
      paragraphIndex += 1;
      const style = paragraphStyle(element);
      const text = decodeXml(collectText(element)).replace(/\s+/g, " ").trim();
      const heading = /^heading/i.test(style);
      if (heading && text) sectionHeading = text;
      if (!text) return;
      const locator = {
        type: "docx" as const,
        sectionHeading,
        paragraphIndex,
        ...(tableCell ? { tableCell } : {}),
      };
      blocks.push({
        kind: heading ? "heading" : tableCell ? "table_cell" : hasNumbering(element) ? "list_item" : "paragraph",
        text,
        locator,
      });
      return;
    }
    for (const child of element.children) {
      if (typeof child !== "string") visit(child, tableCell);
    }
  };
  visit(root, null);
  return blocks;
}

function parseXml(xml: string): XmlElement {
  const root: XmlElement = { name: "#root", attrs: "", children: [] };
  const stack: XmlElement[] = [root];
  const pattern = /<!--[\s\S]*?-->|<\/([^>\s]+)\s*>|<([^!\s>/]+)([^>]*?)(\/?)>|([^<]+)/g;
  for (const match of xml.matchAll(pattern)) {
    const current = stack[stack.length - 1];
    if (!current) break;
    if (match[1]) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    if (match[2]) {
      const element: XmlElement = { name: match[2], attrs: match[3] ?? "", children: [] };
      current.children.push(element);
      if (!match[4]) stack.push(element);
      continue;
    }
    if (match[5]) current.children.push(match[5]);
  }
  return root;
}

function collectText(element: XmlElement): string {
  let text = "";
  for (const child of element.children) {
    if (typeof child === "string") continue;
    const name = localName(child.name);
    if (name === "t") text += child.children.filter((item): item is string => typeof item === "string").join("");
    else if (name === "tab") text += "\t";
    else if (name === "br" || name === "cr") text += "\n";
    else text += collectText(child);
  }
  return text;
}

function paragraphStyle(element: XmlElement): string {
  for (const child of element.children) {
    if (typeof child === "string" || localName(child.name) !== "ppr") continue;
    for (const prop of child.children) {
      if (typeof prop === "string" || localName(prop.name) !== "pstyle") continue;
      return /w:val="([^"]+)"/.exec(prop.attrs)?.[1] ?? /val="([^"]+)"/.exec(prop.attrs)?.[1] ?? "";
    }
  }
  return "";
}

function hasNumbering(element: XmlElement): boolean {
  for (const child of element.children) {
    if (typeof child === "string" || localName(child.name) !== "ppr") continue;
    if (child.children.some((prop) => typeof prop !== "string" && localName(prop.name) === "numpr")) return true;
  }
  return false;
}

function localName(name: string): string {
  const index = name.indexOf(":");
  return (index >= 0 ? name.slice(index + 1) : name).toLowerCase();
}

function decodeXml(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => safeCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => safeCodePoint(Number.parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function safeCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}
