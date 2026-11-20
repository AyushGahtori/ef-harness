import { deflateSync } from "node:zlib";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BrandAssetSanitizer, DERIVATIVE_SIZES, RasterSafetyError } from "../../src/assets/index.js";

const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "package.json"));
const sharp = require("sharp") as (input: Buffer | { create: object }) => {
  jpeg: () => { toBuffer: () => Promise<Buffer> };
  metadata: () => Promise<{ exif?: Buffer; width?: number; height?: number; xmp?: Buffer; iptc?: Buffer }>;
  rotate: () => { png: () => { toBuffer: () => Promise<Buffer> } };
};

const sanitizer = new BrandAssetSanitizer();

describe("BrandAssetSanitizer.sanitizeRaster", () => {
  it("strips EXIF, GPS, and XMP from a tagged JPEG and emits fixed derivatives", async () => {
    const plain = await sharp({
      create: { width: 8, height: 2, channels: 3, background: { r: 12, g: 40, b: 80 } },
    }).jpeg().toBuffer();
    const tagged = injectGpsAndXmp(plain);
    expect(tagged.includes(Buffer.from("Exif"))).toBe(true);
    expect(tagged.includes(Buffer.from("GPSLatitude"))).toBe(true);
    expect(tagged.toString("latin1")).toContain("http://ns.adobe.com/xap/1.0/");
    const clean = await sanitizer.sanitizeRaster(tagged, "image/jpeg");
    const meta = await sharp(clean.bytes).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.iptc).toBeUndefined();
    expect(clean.bytes.includes(Buffer.from("Exif"))).toBe(false);
    expect(clean.bytes.includes(Buffer.from("GPSLatitude"))).toBe(false);
    expect(clean.bytes.toString("latin1")).not.toContain("http://ns.adobe.com/xap");
    expect(clean.bytes.toString("latin1")).not.toContain("Photoshop");
    expect(clean.exifPresent).toBe(false);
    expect(clean.width).toBe(2);
    expect(clean.height).toBe(8);
    expect(clean.derivatives.favicon.width).toBe(DERIVATIVE_SIZES.favicon.width);
    expect(clean.derivatives.favicon.height).toBe(DERIVATIVE_SIZES.favicon.height);
    expect(clean.derivatives.logo1x.width).toBe(256);
    expect(clean.derivatives.logo2x.height).toBe(512);
    expect(clean.derivatives.ogImage).toMatchObject({ width: 1200, height: 630 });
    const again = await sanitizer.sanitizeRaster(tagged, "image/jpeg");
    expect(Buffer.compare(clean.derivatives.favicon.bytes, again.derivatives.favicon.bytes)).toBe(0);
    expect(clean.dominantColorsHex.length).toBeGreaterThan(0);
  });

  it("rejects a 15KB PNG that declares 50000x50000 pixels inside sharp", async () => {
    const bomb = pixelBombPng(50_000, 50_000);
    expect(bomb.length).toBeGreaterThan(14_000);
    expect(bomb.length).toBeLessThan(16_000);
    await expect(sanitizer.sanitizeRaster(bomb, "image/png")).rejects.toBeInstanceOf(RasterSafetyError);
    await expect(sanitizer.sanitizeRaster(bomb, "image/png")).rejects.toThrow(/limitInputPixels: 64000000/);
  });

  it("rejects an animated frame budget before allocating a pixel buffer", async () => {
    const frames = animatedGif(300, 8, 8);
    await expect(sanitizer.sanitizeRaster(frames, "image/gif")).rejects.toMatchObject({ code: "frame-limit" });
    const wide = animatedGif(2, 8000, 8000);
    await expect(sanitizer.sanitizeRaster(wide, "image/gif")).rejects.toMatchObject({ code: "frame-limit" });
  });

  it("re-encodes a tiny GIF and a WebP/AVIF derivative source", async () => {
    const gif = Buffer.from("47494638396101000100800000ffffff0000002c00000000010001000002024401003b", "hex");
    const clean = await sanitizer.sanitizeRaster(gif, "image/gif");
    expect(clean.mimeType).toBe("image/png");
    expect(clean.width).toBe(1);
    expect(clean.height).toBe(1);
    const webp = await sharp(clean.bytes).jpeg().toBuffer();
    const roundTrip = await sanitizer.sanitizeRaster(webp, "image/jpeg");
    expect(roundTrip.metadataStripped).toBe(true);
  });
});

function injectGpsAndXmp(jpeg: Buffer): Buffer {
  const tiff = Buffer.alloc(8 + 2 + 12 + 4 + 2 + 12 * 2 + 4 + 16);
  tiff.write("II", 0, "latin1");
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(2, 8);
  tiff.writeUInt16LE(0x0112, 10);
  tiff.writeUInt16LE(3, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt16LE(6, 18);
  tiff.writeUInt16LE(0x8825, 22);
  tiff.writeUInt16LE(4, 24);
  tiff.writeUInt32LE(1, 26);
  tiff.writeUInt32LE(8 + 2 + 12 * 2 + 4, 30);
  tiff.writeUInt32LE(0, 34);
  const gpsAt = 8 + 2 + 24 + 4;
  tiff.writeUInt16LE(1, gpsAt);
  tiff.write("GPSLatitude", gpsAt + 2, "latin1");
  const exifBody = Buffer.concat([Buffer.from("Exif"), Buffer.from([0, 0]), tiff]);
  const exifLength = Buffer.alloc(2);
  exifLength.writeUInt16BE(exifBody.length + 2);
  const xmpPacket = Buffer.from(
    "<?xpacket begin=\"\"?><x:xmpmeta xmlns:x=\"adobe:ns:meta/\"><rdf:RDF><rdf:Description photoshop:CameraSerialNumber=\"CAM-1\"/></rdf:RDF></x:xmpmeta>",
    "latin1",
  );
  const xmpBody = Buffer.concat([Buffer.from("http://ns.adobe.com/xap/1.0/\x00", "latin1"), xmpPacket]);
  const xmpLength = Buffer.alloc(2);
  xmpLength.writeUInt16BE(xmpBody.length + 2);
  const iptc = Buffer.concat([Buffer.from("Photoshop 3.0", "latin1"), Buffer.from([0]), Buffer.from("8BIM", "latin1")]);
  const iptcLength = Buffer.alloc(2);
  iptcLength.writeUInt16BE(iptc.length + 2);
  const app1Exif = Buffer.concat([Buffer.from([0xff, 0xe1]), exifLength, exifBody]);
  const app1Xmp = Buffer.concat([Buffer.from([0xff, 0xe1]), xmpLength, xmpBody]);
  const app13 = Buffer.concat([Buffer.from([0xff, 0xed]), iptcLength, iptc]);
  return Buffer.concat([jpeg.subarray(0, 2), app1Exif, app1Xmp, app13, jpeg.subarray(2)]);
}

function pixelBombPng(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const padding = Buffer.alloc(15 * 1024 - 80);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("tEXt", padding),
    pngChunk("IDAT", deflateSync(Buffer.from([0, 0]))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, checksum]);
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (~crc) >>> 0;
}

function animatedGif(frames: number, width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.write("GIF89a", 0, "latin1");
  header.writeUInt16LE(width, 6);
  header.writeUInt16LE(height, 8);
  const images: Buffer[] = [];
  for (let frame = 0; frame < frames; frame += 1) {
    const descriptor = Buffer.alloc(10);
    descriptor[0] = 0x2c;
    descriptor.writeUInt16LE(width, 5);
    descriptor.writeUInt16LE(height, 7);
    images.push(descriptor, Buffer.from([0x02, 0x00]));
  }
  return Buffer.concat([header, ...images, Buffer.from([0x3b])]);
}
