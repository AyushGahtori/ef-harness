import { deflateSync, inflateSync } from "node:zlib";
import { crc32 } from "./crc32.js";
import { MAX_IMAGE_PIXELS } from "./limits.js";

export interface Raster {
  readonly width: number;
  readonly height: number;
  readonly rgb: Uint8Array;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([length, typeBuf, data, checksum]);
}

export function encodePng(raster: Raster): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(raster.width, 0);
  ihdr.writeUInt32BE(raster.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows: Buffer[] = [];
  const stride = raster.width * 3;
  for (let y = 0; y < raster.height; y += 1) {
    const row = Buffer.alloc(1 + stride);
    row[0] = 0;
    Buffer.from(raster.rgb.buffer, raster.rgb.byteOffset + y * stride, stride).copy(row, 1);
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export function decodePng(bytes: Uint8Array): Raster | null {
  const buf = Buffer.from(bytes);
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length < 8 || !signature.every((byte, index) => buf[index] === byte)) return null;
  let width = 0;
  let height = 0;
  let colorType = -1;
  const idat: Buffer[] = [];
  let cursor = 8;
  while (cursor + 8 <= buf.length) {
    const length = buf.readUInt32BE(cursor);
    const type = buf.subarray(cursor + 4, cursor + 8).toString("ascii");
    const data = buf.subarray(cursor + 8, cursor + 8 + length);
    cursor += 12 + length;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9] ?? -1;
      if (data[8] !== 8 || data[12] !== 0) return null;
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
  }
  if (width <= 0 || height <= 0 || (colorType !== 2 && colorType !== 0)) return null;
  const inflated = inflateSync(Buffer.concat(idat));
  const channels = colorType === 2 ? 3 : 1;
  const stride = width * channels;
  const rgb = new Uint8Array(width * height * 3);
  let source = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[source] ?? 0;
    source += 1;
    if (filter !== 0) return null;
    for (let x = 0; x < width; x += 1) {
      const dest = (y * width + x) * 3;
      if (channels === 1) {
        const gray = inflated[source] ?? 0;
        source += 1;
        rgb[dest] = gray;
        rgb[dest + 1] = gray;
        rgb[dest + 2] = gray;
      } else {
        rgb[dest] = inflated[source] ?? 0;
        rgb[dest + 1] = inflated[source + 1] ?? 0;
        rgb[dest + 2] = inflated[source + 2] ?? 0;
        source += 3;
      }
    }
    if (source > inflated.length && y < height - 1) return null;
    void stride;
  }
  return { width, height, rgb };
}

export function boundRaster(raster: Raster): Raster {
  const pixels = raster.width * raster.height;
  if (pixels <= MAX_IMAGE_PIXELS) return raster;
  const factor = Math.ceil(Math.sqrt(pixels / MAX_IMAGE_PIXELS));
  const width = Math.max(1, Math.floor(raster.width / factor));
  const height = Math.max(1, Math.floor(raster.height / factor));
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const src = (y * factor * raster.width + x * factor) * 3;
      const dest = (y * width + x) * 3;
      rgb[dest] = raster.rgb[src] ?? 0;
      rgb[dest + 1] = raster.rgb[src + 1] ?? 0;
      rgb[dest + 2] = raster.rgb[src + 2] ?? 0;
    }
  }
  return { width, height, rgb };
}
