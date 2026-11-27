import { createRequire } from "node:module";
import { Buffer } from "node:buffer";
import { assembleDocument } from "./assemble.js";
import { recognizeBitmap, type OcrLine } from "./bitmap-font.js";
import { UnsupportedOrMismatchedFileType } from "./errors.js";
import { MAX_IMAGE_PIXELS } from "./limits.js";
import { decodePng } from "./png-codec.js";
import type { NormalizedDocument, OcrBlock, RawBlock } from "./types.js";

interface DecodedImage {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
  readonly channels: number;
}

interface SharpInfo {
  readonly width: number;
  readonly height: number;
  readonly channels: number;
}

interface SharpPipeline {
  ensureAlpha(): SharpPipeline;
  raw(): SharpPipeline;
  toBuffer(options: { resolveWithObject: true }): Promise<{ data: Buffer; info: SharpInfo }>;
}

type SharpFactory = (input: Buffer, options?: { failOn?: "none"; limitInputPixels?: number }) => SharpPipeline;

const require = createRequire(import.meta.url);

function loadSharp(): SharpFactory | null {
  try {
    const loaded: unknown = require("sharp");
    return typeof loaded === "function" ? (loaded as SharpFactory) : null;
  } catch {
    return null;
  }
}

export class ImageOcrVisionConverter {
  async convert(bytes: Uint8Array, fileName: string, sourceHash: string): Promise<NormalizedDocument> {
    const decoded = await decodeImage(bytes, fileName);
    const lines = await recognizeOffline(
      bytes,
      decoded.pixels,
      decoded.width,
      decoded.height,
      decoded.channels,
    );
    const ocrBlocks: OcrBlock[] = lines.map((line) => ({
      text: line.text,
      confidence: line.confidence,
      bbox: line.bbox,
    }));
    const blocks: RawBlock[] = [];
    if (lines.length === 0) {
      blocks.push({
        kind: "figure",
        text: "",
        locator: {
          type: "image",
          width: decoded.width,
          height: decoded.height,
          ocrBlocks,
        },
      });
    } else {
      for (const line of lines) {
        blocks.push({
          kind: "figure",
          text: line.text,
          locator: {
            type: "image",
            width: decoded.width,
            height: decoded.height,
            ocrBlocks,
          },
        });
      }
    }
    return assembleDocument({
      sourceHash,
      fileName,
      mediaType: "image",
      blocks,
      warnings: [],
      ocrDerived: lines.length > 0,
      stats: { width: decoded.width, height: decoded.height },
    });
  }
}

async function decodeImage(bytes: Uint8Array, fileName: string): Promise<DecodedImage> {
  const sharp = loadSharp();
  if (sharp) {
    const { data, info } = await sharp(Buffer.from(bytes), {
      failOn: "none",
      limitInputPixels: MAX_IMAGE_PIXELS,
    })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return { width: info.width, height: info.height, pixels: data, channels: info.channels };
  }
  const png = decodePng(bytes);
  if (!png) {
    throw new UnsupportedOrMismatchedFileType(`Rejected ${fileName}: image pixels could not be decoded.`);
  }
  return { width: png.width, height: png.height, pixels: png.rgb, channels: 3 };
}

type TesseractRecognize = (image: Buffer, language: string) => Promise<unknown>;

let tesseractRecognize: Promise<TesseractRecognize | null> | null = null;

function loadTesseractRecognize(): Promise<TesseractRecognize | null> {
  tesseractRecognize ??= (async () => {
    try {
      const specifier: string = "tesseract.js";
      const loaded: unknown = await import(specifier);
      if (!loaded || typeof loaded !== "object" || !("recognize" in loaded)) return null;
      const recognize = loaded.recognize;
      if (typeof recognize !== "function") return null;
      return recognize as TesseractRecognize;
    } catch {
      return null;
    }
  })();
  return tesseractRecognize;
}

export async function recognizeOffline(
  imageBytes: Uint8Array,
  pixels: Uint8Array,
  width: number,
  height: number,
  channels: number,
): Promise<OcrLine[]> {
  const tesseract = await recognizeWithTesseract(imageBytes);
  return tesseract ?? recognizeBitmap(pixels, width, height, channels);
}

async function recognizeWithTesseract(bytes: Uint8Array): Promise<OcrLine[] | null> {
  const recognize = await loadTesseractRecognize();
  if (!recognize) return null;
  try {
    return tesseractLines(await recognize(Buffer.from(bytes), "eng"));
  } catch {
    return null;
  }
}

function tesseractLines(result: unknown): OcrLine[] | null {
  if (!result || typeof result !== "object" || !("data" in result)) return null;
  const data = result.data;
  if (!data || typeof data !== "object" || !("words" in data) || !Array.isArray(data.words)) return null;
  const lines: OcrLine[] = [];
  for (const word of data.words) {
    if (!word || typeof word !== "object") continue;
    const text = "text" in word && typeof word.text === "string" ? word.text : "";
    const confidence = "confidence" in word && typeof word.confidence === "number" ? word.confidence / 100 : 0;
    const bbox = "bbox" in word && word.bbox && typeof word.bbox === "object" ? word.bbox : null;
    if (!text || !bbox) continue;
    const x0 = "x0" in bbox && typeof bbox.x0 === "number" ? bbox.x0 : 0;
    const y0 = "y0" in bbox && typeof bbox.y0 === "number" ? bbox.y0 : 0;
    const x1 = "x1" in bbox && typeof bbox.x1 === "number" ? bbox.x1 : x0;
    const y1 = "y1" in bbox && typeof bbox.y1 === "number" ? bbox.y1 : y0;
    lines.push({ text, confidence, bbox: [x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0)] });
  }
  return lines;
}
