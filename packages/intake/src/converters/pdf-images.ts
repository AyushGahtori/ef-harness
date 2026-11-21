import { inflateRawSync } from "node:zlib";
import { FileExpansionLimitError } from "./errors.js";
import { MAX_UNCOMPRESSED_BYTES } from "./limits.js";

export interface PdfImage {
  readonly page: number;
  readonly width: number;
  readonly height: number;
  readonly rgb: Uint8Array;
}

interface PdfObj {
  readonly dict: string;
  readonly stream: Uint8Array | null;
}

export function extractPdfImages(bytes: Uint8Array): PdfImage[] {
  const objects = loadObjects(Buffer.from(bytes));
  const pages = pageRefs(objects);
  const images: PdfImage[] = [];
  pages.forEach((pageId, index) => {
    const page = objects.get(pageId);
    if (!page) return;
    const xobjects = balanced(page.dict, "XObject");
    if (!xobjects) return;
    for (const match of xobjects.matchAll(/\/(\w+)\s+(\d+)\s+0\s+R/g)) {
      const id = Number(match[2]);
      const image = objects.get(id);
      if (!image?.stream || !/\/Subtype\s*\/Image/.test(image.dict)) continue;
      const width = numberValue(image.dict, "Width");
      const height = numberValue(image.dict, "Height");
      if (!width || !height) continue;
      const decoded = decodeStream(image);
      const channels = /\/DeviceGray/.test(image.dict) ? 1 : 3;
      if (decoded.length < width * height * channels) continue;
      const rgb = new Uint8Array(width * height * 3);
      for (let pixel = 0; pixel < width * height; pixel += 1) {
        if (channels === 1) {
          const gray = decoded[pixel] ?? 0;
          rgb[pixel * 3] = gray;
          rgb[pixel * 3 + 1] = gray;
          rgb[pixel * 3 + 2] = gray;
        } else {
          rgb[pixel * 3] = decoded[pixel * 3] ?? 0;
          rgb[pixel * 3 + 1] = decoded[pixel * 3 + 1] ?? 0;
          rgb[pixel * 3 + 2] = decoded[pixel * 3 + 2] ?? 0;
        }
      }
      images.push({ page: index + 1, width, height, rgb });
    }
  });
  return images;
}

function loadObjects(buf: Buffer): Map<number, PdfObj> {
  const objects = new Map<number, PdfObj>();
  const xref = readXref(buf);
  const offsets = xref ?? scanObjectOffsets(buf);
  for (const [id, offset] of offsets) {
    const parsed = readObject(buf, offset);
    if (parsed) objects.set(id, parsed);
  }
  return objects;
}

function readXref(buf: Buffer): Map<number, number> | null {
  const marker = buf.lastIndexOf("startxref");
  if (marker < 0) return null;
  const tail = buf.subarray(marker, Math.min(buf.length, marker + 64)).toString("latin1");
  const at = /startxref\s+(\d+)/.exec(tail);
  if (!at?.[1]) return null;
  const xrefAt = Number(at[1]);
  if (!buf.subarray(xrefAt, xrefAt + 4).toString("latin1").startsWith("xref")) return null;
  const text = buf.subarray(xrefAt, Math.min(buf.length, xrefAt + 200_000)).toString("latin1");
  const lines = text.split(/\r?\n/);
  const offsets = new Map<number, number>();
  let lineIndex = 1;
  while (lineIndex < lines.length) {
    const header = /^(\d+)\s+(\d+)$/.exec(lines[lineIndex] ?? "");
    if (!header?.[1] || !header[2]) break;
    const start = Number(header[1]);
    const count = Number(header[2]);
    lineIndex += 1;
    for (let i = 0; i < count; i += 1) {
      const row = lines[lineIndex] ?? "";
      lineIndex += 1;
      const entry = /^(\d{10})\s+(\d{5})\s+([nf])/.exec(row);
      if (entry?.[3] === "n" && entry[1]) offsets.set(start + i, Number(entry[1]));
    }
  }
  return offsets.size > 0 ? offsets : null;
}

function scanObjectOffsets(buf: Buffer): Map<number, number> {
  const offsets = new Map<number, number>();
  const text = buf.toString("latin1");
  for (const match of text.matchAll(/(\d+)\s+0\s+obj/g)) {
    if (match[1] && match.index !== undefined) offsets.set(Number(match[1]), match.index);
  }
  return offsets;
}

function readObject(buf: Buffer, offset: number): PdfObj | null {
  const prelude = buf.subarray(offset, Math.min(buf.length, offset + 64)).toString("latin1");
  const header = /^\s*(\d+)\s+\d+\s+obj\s*/.exec(prelude);
  if (!header) return null;
  const bodyAt = offset + header[0].length;
  const endObj = buf.indexOf("endobj", bodyAt);
  const streamAt = indexOfAscii(buf, "stream", bodyAt, endObj > 0 ? endObj : bodyAt + 8192);
  if (streamAt < 0 || (endObj > 0 && streamAt > endObj)) {
    const dict = buf.subarray(bodyAt, endObj > 0 ? endObj : bodyAt + 4096).toString("latin1");
    return { dict, stream: null };
  }
  const dict = buf.subarray(bodyAt, streamAt).toString("latin1");
  let dataAt = streamAt + "stream".length;
  if (buf[dataAt] === 0x0d && buf[dataAt + 1] === 0x0a) dataAt += 2;
  else if (buf[dataAt] === 0x0a) dataAt += 1;
  const length = numberValue(dict, "Length") ?? 0;
  const stream = buf.subarray(dataAt, dataAt + length);
  return { dict, stream };
}

function pageRefs(objects: Map<number, PdfObj>): number[] {
  let pagesId: number | null = null;
  for (const [id, object] of objects) {
    if (/\/Type\s*\/Catalog/.test(object.dict)) {
      pagesId = refValue(object.dict, "Pages");
      void id;
      break;
    }
  }
  if (pagesId === null) {
    return [...objects.entries()].filter(([, object]) => /\/Type\s*\/Page\b/.test(object.dict)).map(([id]) => id);
  }
  return walkPages(objects, pagesId);
}

function walkPages(objects: Map<number, PdfObj>, id: number): number[] {
  const object = objects.get(id);
  if (!object) return [];
  if (/\/Type\s*\/Page\b/.test(object.dict) && !/\/Type\s*\/Pages\b/.test(object.dict)) return [id];
  const kids = /\/Kids\s*\[([^\]]*)\]/.exec(object.dict)?.[1] ?? "";
  const ids = [...kids.matchAll(/(\d+)\s+0\s+R/g)].map((match) => Number(match[1]));
  return ids.flatMap((kid) => walkPages(objects, kid));
}

function decodeStream(object: PdfObj): Uint8Array {
  const stream = object.stream ?? Buffer.alloc(0);
  if (!/\/FlateDecode/.test(object.dict)) return stream;
  const width = numberValue(object.dict, "Width") ?? 0;
  const height = numberValue(object.dict, "Height") ?? 0;
  const channels = /\/DeviceGray/.test(object.dict) ? 1 : 3;
  const expected = width > 0 && height > 0 ? width * height * channels : MAX_UNCOMPRESSED_BYTES;
  if (expected > MAX_UNCOMPRESSED_BYTES) {
    throw new FileExpansionLimitError("PDF image stream exceeded the expansion cap.");
  }
  try {
    return inflateRawSync(stream, { maxOutputLength: Math.min(expected, MAX_UNCOMPRESSED_BYTES) });
  } catch (error) {
    if (error instanceof RangeError) {
      throw new FileExpansionLimitError("PDF image stream exceeded the expansion cap.");
    }
    throw error;
  }
}

function numberValue(dict: string, key: string): number | null {
  const match = new RegExp(`\\/${key}\\s+(\\d+)`).exec(dict);
  if (!match?.[1]) return null;
  return Number(match[1]);
}

function refValue(dict: string, key: string): number | null {
  const match = new RegExp(`\\/${key}\\s+(\\d+)\\s+0\\s+R`).exec(dict);
  if (!match?.[1]) return null;
  return Number(match[1]);
}

function balanced(dict: string, key: string): string | null {
  const token = `/${key}`;
  const at = dict.indexOf(token);
  if (at < 0) return null;
  const open = dict.indexOf("<<", at);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < dict.length - 1; i += 1) {
    if (dict[i] === "<" && dict[i + 1] === "<") {
      depth += 1;
      i += 1;
      continue;
    }
    if (dict[i] === ">" && dict[i + 1] === ">") {
      depth -= 1;
      i += 1;
      if (depth === 0) return dict.slice(open + 2, i - 1);
    }
  }
  return null;
}

function indexOfAscii(buf: Buffer, needle: string, from: number, until: number): number {
  const found = buf.indexOf(needle, from);
  if (found < 0 || found > until) return -1;
  return found;
}
