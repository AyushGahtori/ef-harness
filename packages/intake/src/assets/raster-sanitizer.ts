import { RasterSafetyError } from "./errors.js";
import { loadSharp, type SharpFactory, type SharpInstance } from "./engines.js";
import { DERIVATIVE_SIZES, MAX_RASTER_PIXELS, type DerivativeName } from "./limits.js";
import { assertPreSharpBudget, readRasterHeader, type RasterFormat } from "./raster-header.js";

export interface RasterDerivative {
  readonly name: DerivativeName;
  readonly mimeType: "image/png";
  readonly bytes: Buffer;
  readonly width: number;
  readonly height: number;
}

export interface SanitizedRaster {
  readonly mimeType: "image/png";
  readonly bytes: Buffer;
  readonly width: number;
  readonly height: number;
  readonly sourceFormat: RasterFormat;
  readonly derivatives: Readonly<Record<DerivativeName, RasterDerivative>>;
  readonly dominantColorsHex: readonly string[];
  readonly exifPresent: false;
  readonly metadataStripped: true;
}

const FORBIDDEN_PNG_CHUNKS = new Set(["eXIf", "tEXt", "iTXt", "zTXt", "tIME"]);

export async function sanitizeRasterBytes(
  input: Uint8Array,
  factory: SharpFactory = loadSharp(),
): Promise<SanitizedRaster> {
  const header = readRasterHeader(input);
  assertPreSharpBudget(input, header);
  let cleaned: Buffer;
  try {
    cleaned = await factory(Buffer.from(input), {
      limitInputPixels: MAX_RASTER_PIXELS,
      animated: false,
      failOn: "error",
    }).rotate().png({ compressionLevel: 9 }).toBuffer();
  } catch (error) {
    throw mapSharpError(error, header);
  }
  const meta = await factory(cleaned).metadata();
  if (meta.exif || meta.xmp || meta.iptc) {
    throw new RasterSafetyError("decode", "Re-encoded raster still carries EXIF, XMP, or IPTC metadata");
  }
  assertPngMetadataFree(cleaned);
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width <= 0 || height <= 0) {
    throw new RasterSafetyError("decode", "Re-encoded raster has no dimensions");
  }
  if (width * height > MAX_RASTER_PIXELS) {
    throw new RasterSafetyError(
      "pixel-bomb",
      `sharp({ limitInputPixels: ${MAX_RASTER_PIXELS} }) output still exceeds the pixel cap`,
    );
  }
  const derivatives = await buildDerivatives(factory, cleaned);
  return {
    mimeType: "image/png",
    bytes: cleaned,
    width,
    height,
    sourceFormat: header.format,
    derivatives,
    dominantColorsHex: await dominantColors(factory, cleaned),
    exifPresent: false,
    metadataStripped: true,
  };
}

export async function invertMonochrome(bytes: Uint8Array, factory: SharpFactory = loadSharp()): Promise<Buffer> {
  return factory(Buffer.from(bytes)).greyscale().negate({ alpha: false }).png({ compressionLevel: 9 }).toBuffer();
}

async function buildDerivatives(
  factory: SharpFactory,
  cleaned: Buffer,
): Promise<Record<DerivativeName, RasterDerivative>> {
  const names = Object.keys(DERIVATIVE_SIZES) as DerivativeName[];
  const entries = await Promise.all(names.map(async (name) => {
    const size = DERIVATIVE_SIZES[name];
    const bytes = await resize(factory(cleaned), size.width, size.height);
    const meta = await factory(bytes).metadata();
    return [name, {
      name,
      mimeType: "image/png" as const,
      bytes,
      width: meta.width ?? size.width,
      height: meta.height ?? size.height,
    }] as const;
  }));
  return Object.fromEntries(entries) as Record<DerivativeName, RasterDerivative>;
}

function resize(image: SharpInstance, width: number, height: number): Promise<Buffer> {
  return image.resize(width, height, {
    fit: "contain",
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  }).png({ compressionLevel: 9 }).toBuffer();
}

async function dominantColors(factory: SharpFactory, cleaned: Buffer): Promise<string[]> {
  const { data, info } = await factory(cleaned).resize(8, 8, {
    fit: "fill",
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
  const channels = info.channels || 3;
  for (let offset = 0; offset + 2 < data.length; offset += channels) {
    const r = quantize(data[offset] ?? 0);
    const g = quantize(data[offset + 1] ?? 0);
    const b = quantize(data[offset + 2] ?? 0);
    const key = `${r},${g},${b}`;
    const current = buckets.get(key);
    if (current) current.count += 1;
    else buckets.set(key, { count: 1, r, g, b });
  }
  return [...buckets.values()]
    .sort((left, right) => right.count - left.count || left.r - right.r || left.g - right.g || left.b - right.b)
    .slice(0, 4)
    .map((bucket) => toHex(bucket.r, bucket.g, bucket.b));
}

function quantize(channel: number): number {
  return Math.max(0, Math.min(255, Math.round(channel / 16) * 16));
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function assertPngMetadataFree(bytes: Buffer): void {
  if (bytes.length < 8) {
    throw new RasterSafetyError("decode", "Re-encoded bytes are not a PNG");
  }
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    if (FORBIDDEN_PNG_CHUNKS.has(type)) {
      throw new RasterSafetyError("decode", `Re-encoded PNG still contains a ${type} metadata chunk`);
    }
    if (type === "IEND") return;
    offset += 12 + length;
  }
}

function mapSharpError(error: unknown, header: { width: number; height: number }): RasterSafetyError {
  const message = error instanceof Error ? error.message : String(error);
  const declared = header.width > 0 && header.height > 0 ? header.width * header.height : 0;
  if (/pixel limit/i.test(message) || declared > MAX_RASTER_PIXELS) {
    return new RasterSafetyError(
      "pixel-bomb",
      `sharp({ limitInputPixels: ${MAX_RASTER_PIXELS} }) rejected the input before allocating a pixel buffer: ${message}`,
    );
  }
  return new RasterSafetyError("decode", message);
}
