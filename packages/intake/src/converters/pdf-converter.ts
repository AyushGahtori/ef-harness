import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { assembleDocument } from "./assemble.js";
import { recognizeOffline } from "./image-ocr-converter.js";
import { PasswordRequiredError, PageRangeRequiredError } from "./errors.js";
import { MAX_PDF_PAGES_PER_PASS, PDF_OCR_CHAR_THRESHOLD } from "./limits.js";
import { extractPdfImages, type PdfImage } from "./pdf-images.js";
import { boundRaster, decodePng, encodePng } from "./png-codec.js";
import { hiddenTextWarning, stripStealthUnicode } from "./unicode-sanitizer.js";
import type { NormalizedDocument, RawBlock } from "./types.js";

interface TextItem {
  readonly str: string;
  readonly width: number;
  readonly height: number;
  readonly transform: readonly number[];
}

export interface PdfConvertOptions {
  readonly pageStart?: number;
  readonly pageEnd?: number;
}

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

interface PlacedText {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fontSize: number;
}

let workerReady: Promise<void> | null = null;

function ensureInProcessPdfWorker(): Promise<void> {
  workerReady ??= (async () => {
    const specifier: string = "pdfjs-dist/legacy/build/pdf.worker.mjs";
    const loaded: unknown = await import(specifier);
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = loaded;
  })();
  return workerReady;
}

export class PdfConverter {
  async convert(
    bytes: Uint8Array,
    fileName: string,
    sourceHash: string,
    options: PdfConvertOptions = {},
  ): Promise<NormalizedDocument> {
    assertUnlockedPdf(bytes);
    await ensureInProcessPdfWorker();
    const pdf = await openPdf(bytes);
    try {
      const pageCount = pdf.numPages;
      const range = resolveRange(pageCount, options);
      const images = extractPdfImages(bytes);
      const blocks: RawBlock[] = [];
      const warnings = [];
      let hidden = false;
      let ocrDerived = false;
      for (let pageNumber = range.start; pageNumber <= range.end; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const view = page.view;
        const pageHeight = (view[3] ?? 792) - (view[1] ?? 0);
        const operatorList = await page.getOperatorList();
        const textContent = await page.getTextContent();
        const placed = placeVisibleText(textContent.items, operatorList.fnArray, operatorList.argsArray, pageHeight);
        if (placed.hidden) hidden = true;
        const printable = placed.lines
          .map((line) => line.map((item) => item.text).join(""))
          .join("")
          .replace(/\s+/g, "");
        blocks.push(...blocksFromLines(placed.lines, pageNumber));
        if (printable.length < PDF_OCR_CHAR_THRESHOLD) {
          const pageImages = images.filter((image) => image.page === pageNumber);
          const ocrBlocks = await ocrPageImages(pageImages, pageNumber);
          if (ocrBlocks.length > 0) {
            ocrDerived = true;
            blocks.push(...ocrBlocks);
          }
        }
      }
      if (hidden) warnings.push(hiddenTextWarning());
      return assembleDocument({
        sourceHash,
        fileName,
        mediaType: "pdf",
        blocks,
        warnings,
        ocrDerived,
        stats: { pageCount },
      });
    } finally {
      await pdf.destroy();
    }
  }
}

function resolveRange(pageCount: number, options: PdfConvertOptions): { readonly start: number; readonly end: number } {
  const requested = options.pageStart !== undefined || options.pageEnd !== undefined;
  const start = options.pageStart ?? 1;
  const end = options.pageEnd ?? pageCount;
  const span = end - start + 1;
  if (!requested && pageCount > MAX_PDF_PAGES_PER_PASS) {
    throw new PageRangeRequiredError();
  }
  if (span > MAX_PDF_PAGES_PER_PASS || start < 1 || end > pageCount || end < start) {
    throw new PageRangeRequiredError();
  }
  return { start, end };
}

function assertUnlockedPdf(bytes: Uint8Array): void {
  const tail = Buffer.from(bytes.subarray(Math.max(0, bytes.length - 8192))).toString("latin1");
  if (/\/Encrypt\b/.test(tail)) throw new PasswordRequiredError();
}

async function openPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  const copy = new Uint8Array(bytes);
  try {
    const task = getDocument({
      data: copy,
      disableFontFace: true,
      useSystemFonts: false,
      useWorkerFetch: false,
      verbosity: 0,
    } as Parameters<typeof getDocument>[0]);
    return await task.promise;
  } catch (error) {
    if (isPasswordMessage(error)) {
      throw new PasswordRequiredError();
    }
    throw error;
  }
}

function isPasswordMessage(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String(error.name) : "";
  const message = "message" in error ? String(error.message) : "";
  return name === "PasswordException" || /password/i.test(message);
}

function placeVisibleText(
  items: readonly unknown[],
  fnArray: readonly number[],
  argsArray: readonly unknown[],
  pageHeight: number,
): { readonly lines: PlacedText[][]; readonly hidden: boolean } {
  const segments = textSegments(fnArray, argsArray);
  const textItems = items.filter(isTextItem).filter((item) => item.str.length > 0);
  const placed: PlacedText[] = [];
  let hidden = segments.some((segment) => segment.hidden && segment.text.length > 0);
  const hiddenText = segments.filter((segment) => segment.hidden && segment.text.length > 0).map((segment) => segment.text);
  textItems.forEach((item) => {
    const segment = segments.find((candidate) => candidate.text === item.str);
    const fontSize = segment?.fontSize ?? (item.height > 0 ? item.height : 12);
    const concealed =
      (segment?.hidden ?? false) ||
      (item.height > 0 && item.height <= 1) ||
      hiddenText.some((text) => text === item.str || (item.str.length > 2 && text.includes(item.str)));
    if (concealed) {
      hidden = true;
      return;
    }
    const transform = Array.isArray(item.transform) ? item.transform : [];
    const x = numberAt(transform, 4);
    const yPdf = numberAt(transform, 5);
    placed.push({
      text: stripStealthUnicode(item.str).text,
      x,
      y: pageHeight - (yPdf + item.height),
      width: item.width,
      height: item.height,
      fontSize,
    });
  });
  const groups = new Map<number, PlacedText[]>();
  for (const item of placed) {
    const key = Math.round(item.y);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  const lines = [...groups.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([, group]) => group.sort((left, right) => left.x - right.x));
  return { lines, hidden };
}

function blocksFromLines(lines: readonly (readonly PlacedText[])[], pageNumber: number): RawBlock[] {
  const blocks: RawBlock[] = [];
  lines.forEach((line, lineIndex) => {
    const lineNumber = lineIndex + 1;
    const table = isTableLine(line);
    if (table) {
      line.forEach((cell) => {
        const text = cell.text.trim();
        if (!text) return;
        blocks.push({
          kind: "table_cell",
          text,
          locator: {
            type: "pdf",
            page: pageNumber,
            lineStart: lineNumber,
            lineEnd: lineNumber,
            bbox: box(cell),
          },
        });
      });
      return;
    }
    const text = joinLine(line).trim();
    if (!text) return;
    const first = line[0];
    const fontSize = Math.max(...line.map((item) => item.fontSize));
    const kind = fontSize >= 14 ? "heading" : isList(text) ? "list_item" : "paragraph";
    blocks.push({
      kind,
      text,
      locator: {
        type: "pdf",
        page: pageNumber,
        lineStart: lineNumber,
        lineEnd: lineNumber,
        ...(first ? { bbox: unionBox(line) } : {}),
      },
    });
  });
  return blocks;
}

async function ocrPageImages(images: readonly PdfImage[], pageNumber: number): Promise<RawBlock[]> {
  const blocks: RawBlock[] = [];
  for (const image of images) {
    const bounded = boundRaster({ width: image.width, height: image.height, rgb: image.rgb });
    const png = encodePng(bounded);
    const decoded = decodePng(png) ?? bounded;
    const lines = await recognizeOffline(png, decoded.rgb, decoded.width, decoded.height, 3);
    for (const line of lines) {
      blocks.push({
        kind: "figure",
        text: line.text,
        locator: {
          type: "pdf_ocr",
          page: pageNumber,
          confidence: line.confidence,
          bbox: line.bbox,
        },
      });
    }
  }
  return blocks;
}

function textSegments(fnArray: readonly number[], argsArray: readonly unknown[]): Array<{
  readonly text: string;
  readonly hidden: boolean;
  readonly fontSize: number;
}> {
  let fontSize = 12;
  let fill: Rgb = { r: 0, g: 0, b: 0 };
  let renderMode = 0;
  const segments: Array<{ text: string; hidden: boolean; fontSize: number }> = [];
  fnArray.forEach((fn, index) => {
    const args = argsArray[index];
    if (fn === OPS.setFont) {
      const size = Array.isArray(args) ? args[1] : undefined;
      if (typeof size === "number" && Number.isFinite(size)) fontSize = size;
      return;
    }
    if (fn === OPS.setFillRGBColor || fn === OPS.setFillGray || fn === OPS.setFillCMYKColor) {
      const next = parseFill(args);
      if (next) fill = next;
      return;
    }
    if (fn === OPS.setTextRenderingMode) {
      const mode = Array.isArray(args) ? args[0] : args;
      if (typeof mode === "number" && Number.isFinite(mode)) renderMode = mode;
      return;
    }
    if (
      fn === OPS.showText ||
      fn === OPS.showSpacedText ||
      fn === OPS.nextLineShowText ||
      fn === OPS.nextLineSetSpacingShowText
    ) {
      const text = glyphsToString(args);
      if (!text) return;
      segments.push({
        text,
        fontSize,
        hidden: fontSize <= 1 || renderMode === 3 || isNearWhite(fill),
      });
    }
  });
  return segments;
}

function glyphsToString(args: unknown): string {
  const list = Array.isArray(args) && Array.isArray(args[0]) ? args[0] : args;
  if (!Array.isArray(list)) return "";
  let text = "";
  for (const glyph of list) {
    if (glyph && typeof glyph === "object" && "unicode" in glyph) {
      const unicode = glyph.unicode;
      if (typeof unicode === "string") text += unicode;
    }
  }
  return text;
}

function parseFill(args: unknown): Rgb | null {
  const first = Array.isArray(args) ? args[0] : args;
  if (typeof first === "string" && /^#[0-9a-fA-F]{6}$/.test(first)) {
    return {
      r: Number.parseInt(first.slice(1, 3), 16) / 255,
      g: Number.parseInt(first.slice(3, 5), 16) / 255,
      b: Number.parseInt(first.slice(5, 7), 16) / 255,
    };
  }
  if (typeof first === "number" && Number.isFinite(first)) return { r: first, g: first, b: first };
  if (Array.isArray(args) && args.length >= 3 && args.every((item) => typeof item === "number")) {
    const [r, g, b] = args;
    if (r === undefined || g === undefined || b === undefined) return null;
    return { r, g, b };
  }
  return null;
}

function isNearWhite(fill: Rgb): boolean {
  return fill.r >= 0.97 && fill.g >= 0.97 && fill.b >= 0.97;
}

function isTextItem(item: unknown): item is TextItem {
  return typeof item === "object" && item !== null && "str" in item && typeof item.str === "string";
}

function numberAt(values: readonly unknown[], index: number): number {
  const value = values[index];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isTableLine(line: readonly PlacedText[]): boolean {
  if (line.length < 2) return false;
  for (let i = 1; i < line.length; i += 1) {
    const previous = line[i - 1];
    const current = line[i];
    if (!previous || !current) continue;
    if (current.x - (previous.x + previous.width) > 24) return true;
  }
  return false;
}

function joinLine(line: readonly PlacedText[]): string {
  let text = "";
  line.forEach((item, index) => {
    if (index === 0) {
      text = item.text;
      return;
    }
    const previous = line[index - 1];
    const gap = previous ? item.x - (previous.x + previous.width) : 0;
    text += gap > 1.5 ? ` ${item.text}` : item.text;
  });
  return text;
}

function isList(text: string): boolean {
  return /^(?:[-*•]|\d+[.)])\s+/.test(text);
}

function box(item: PlacedText): readonly [number, number, number, number] {
  return [round(item.x), round(item.y), round(item.width), round(item.height)];
}

function unionBox(line: readonly PlacedText[]): readonly [number, number, number, number] {
  const first = line[0];
  if (!first) return [0, 0, 0, 0];
  let x0 = first.x;
  let y0 = first.y;
  let x1 = first.x + first.width;
  let y1 = first.y + first.height;
  for (const item of line) {
    x0 = Math.min(x0, item.x);
    y0 = Math.min(y0, item.y);
    x1 = Math.max(x1, item.x + item.width);
    y1 = Math.max(y1, item.y + item.height);
  }
  return [round(x0), round(y0), round(x1 - x0), round(y1 - y0)];
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
