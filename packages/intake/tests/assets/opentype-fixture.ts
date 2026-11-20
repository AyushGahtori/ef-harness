/**
 * Builds a tiny TrueType font fontkit can open.
 * The license name record and OS/2 fsType are the fields the inspector reads.
 */

function u16(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16BE(value & 0xffff, 0);
  return buffer;
}

function i16(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeInt16BE(value, 0);
  return buffer;
}

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0, 0);
  return buffer;
}

function pad4(buffer: Buffer): Buffer {
  const extra = (4 - (buffer.length % 4)) % 4;
  return extra === 0 ? buffer : Buffer.concat([buffer, Buffer.alloc(extra)]);
}

function checksum(buffer: Buffer): number {
  const padded = pad4(buffer);
  let sum = 0;
  for (let offset = 0; offset < padded.length; offset += 4) {
    sum = (sum + padded.readUInt32BE(offset)) >>> 0;
  }
  return sum;
}

function utf16be(value: string): Buffer {
  return Buffer.from(value, "utf16le").swap16();
}

export interface FixtureFontOptions {
  readonly familyName: string;
  readonly subfamily?: string;
  readonly postscriptName?: string;
  readonly license?: string;
  readonly copyright?: string;
  /** OS/2 fsType. Bit 1 (value 2) is restricted embedding. */
  readonly fsType?: number;
  readonly weight?: number;
  readonly italic?: boolean;
}

export function buildFixtureFont(options: FixtureFontOptions): Buffer {
  const subfamily = options.subfamily ?? (options.italic ? "Italic" : "Regular");
  const postscriptName = options.postscriptName ?? options.familyName.replaceAll(" ", "");
  const tables = new Map<string, Buffer>();
  tables.set("OS/2", buildOs2(options.weight ?? 400, options.fsType ?? 0, options.italic === true));
  tables.set("cmap", buildCmap());
  tables.set("glyf", buildGlyf());
  tables.set("head", buildHead());
  tables.set("hhea", buildHhea());
  tables.set("hmtx", buildHmtx());
  tables.set("loca", buildLoca());
  tables.set("maxp", buildMaxp());
  tables.set("name", buildName({
    familyName: options.familyName,
    subfamily,
    postscriptName,
    license: options.license ?? "",
    copyright: options.copyright ?? "",
  }));
  tables.set("post", buildPost(options.italic === true));

  const tags = [...tables.keys()].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const count = tags.length;
  const searchRange = 16 * 2 ** Math.floor(Math.log2(count));
  const entrySelector = Math.floor(Math.log2(count));
  const rangeShift = count * 16 - searchRange;
  let offset = 12 + count * 16;
  const directory: Buffer[] = [u32(0x00010000), u16(count), u16(searchRange), u16(entrySelector), u16(rangeShift)];
  const blobs: Buffer[] = [];
  for (const tag of tags) {
    const table = tables.get(tag);
    if (!table) continue;
    const aligned = pad4(table);
    directory.push(Buffer.from(tag), u32(checksum(table)), u32(offset), u32(table.length));
    blobs.push(aligned);
    offset += aligned.length;
  }
  const font = Buffer.concat([...directory, ...blobs]);
  const headOffset = readTableOffset(font, "head");
  font.writeUInt32BE(0, headOffset + 8);
  const adjustment = (0xb1b0afba - checksum(font)) >>> 0;
  font.writeUInt32BE(adjustment, headOffset + 8);
  return font;
}

function readTableOffset(font: Buffer, tag: string): number {
  const count = font.readUInt16BE(4);
  for (let index = 0; index < count; index += 1) {
    const at = 12 + index * 16;
    if (font.toString("latin1", at, at + 4) === tag) return font.readUInt32BE(at + 8);
  }
  throw new Error(`missing ${tag} table`);
}

function buildHead(): Buffer {
  const head = Buffer.alloc(54);
  head.writeUInt32BE(0x00010000, 0);
  head.writeUInt32BE(0x00010000, 4);
  head.writeUInt32BE(0, 8);
  head.writeUInt32BE(0x5f0f3cf5, 12);
  head.writeUInt16BE(0, 16);
  head.writeUInt16BE(1000, 18);
  head.writeInt16BE(0, 36);
  head.writeInt16BE(0, 38);
  head.writeInt16BE(500, 40);
  head.writeInt16BE(700, 42);
  head.writeInt16BE(8, 46);
  head.writeInt16BE(2, 48);
  head.writeInt16BE(0, 50);
  head.writeInt16BE(0, 52);
  return head;
}

function buildHhea(): Buffer {
  const hhea = Buffer.alloc(36);
  hhea.writeUInt32BE(0x00010000, 0);
  hhea.writeInt16BE(800, 4);
  hhea.writeInt16BE(-200, 6);
  hhea.writeInt16BE(0, 8);
  hhea.writeUInt16BE(600, 10);
  hhea.writeInt16BE(0, 12);
  hhea.writeInt16BE(0, 14);
  hhea.writeInt16BE(500, 16);
  hhea.writeInt16BE(1, 18);
  hhea.writeInt16BE(0, 20);
  hhea.writeInt16BE(0, 22);
  hhea.writeUInt16BE(2, 34);
  return hhea;
}

function buildMaxp(): Buffer {
  const maxp = Buffer.alloc(32);
  maxp.writeUInt32BE(0x00010000, 0);
  maxp.writeUInt16BE(2, 4);
  maxp.writeUInt16BE(1, 6);
  maxp.writeUInt16BE(1, 8);
  maxp.writeUInt16BE(0, 10);
  maxp.writeUInt16BE(0, 12);
  maxp.writeUInt16BE(2, 14);
  return maxp;
}

function buildHmtx(): Buffer {
  return Buffer.concat([u16(600), i16(0), u16(600), i16(0)]);
}

function buildGlyf(): Buffer {
  const glyph = Buffer.alloc(10);
  glyph.writeInt16BE(0, 0);
  glyph.writeInt16BE(0, 2);
  glyph.writeInt16BE(0, 4);
  glyph.writeInt16BE(500, 6);
  glyph.writeInt16BE(700, 8);
  return glyph;
}

function buildLoca(): Buffer {
  return Buffer.concat([u16(0), u16(0), u16(5)]);
}

function buildPost(italic: boolean): Buffer {
  const post = Buffer.alloc(32);
  post.writeUInt32BE(0x00030000, 0);
  post.writeInt32BE(italic ? -0x100000 : 0, 4);
  post.writeInt16BE(-100, 8);
  post.writeInt16BE(50, 10);
  return post;
}

function buildOs2(weight: number, fsType: number, italic: boolean): Buffer {
  const os2 = Buffer.alloc(78);
  os2.writeUInt16BE(0, 0);
  os2.writeInt16BE(500, 2);
  os2.writeUInt16BE(weight, 4);
  os2.writeUInt16BE(5, 6);
  os2.writeUInt16BE(fsType, 8);
  os2.writeUInt32BE(0x00000001, 42);
  os2.write("EFH ", 58, "latin1");
  os2.writeUInt16BE(italic ? 0x0001 : 0x0040, 62);
  os2.writeUInt16BE(0x0041, 64);
  os2.writeUInt16BE(0x0041, 66);
  os2.writeInt16BE(800, 68);
  os2.writeInt16BE(-200, 70);
  os2.writeInt16BE(0, 72);
  os2.writeUInt16BE(800, 74);
  os2.writeUInt16BE(200, 76);
  return os2;
}

function buildCmap(): Buffer {
  const segCount = 2;
  const segCountX2 = segCount * 2;
  const searchRange = 2 * 2 ** Math.floor(Math.log2(segCount));
  const entrySelector = Math.floor(Math.log2(segCount));
  const rangeShift = segCountX2 - searchRange;
  const subtable = Buffer.concat([
    u16(4),
    u16(32),
    u16(0),
    u16(segCountX2),
    u16(searchRange),
    u16(entrySelector),
    u16(rangeShift),
    u16(0x0041),
    u16(0xffff),
    u16(0),
    u16(0x0041),
    u16(0xffff),
    u16((1 - 0x41) & 0xffff),
    u16(1),
    u16(0),
    u16(0),
  ]);
  return Buffer.concat([u16(0), u16(1), u16(3), u16(1), u32(12), subtable]);
}

function buildName(input: {
  readonly familyName: string;
  readonly subfamily: string;
  readonly postscriptName: string;
  readonly license: string;
  readonly copyright: string;
}): Buffer {
  const entries: Array<{ id: number; text: string }> = [
    { id: 1, text: input.familyName },
    { id: 2, text: input.subfamily },
    { id: 4, text: `${input.familyName} ${input.subfamily}` },
    { id: 6, text: input.postscriptName },
  ];
  if (input.copyright) entries.push({ id: 0, text: input.copyright });
  if (input.license) entries.push({ id: 13, text: input.license });
  entries.sort((left, right) => left.id - right.id);
  const strings = entries.map((entry) => utf16be(entry.text));
  const records: Buffer[] = [];
  let stringOffset = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const encoded = strings[index];
    if (!entry || !encoded) continue;
    records.push(Buffer.concat([
      u16(3),
      u16(1),
      u16(0x0409),
      u16(entry.id),
      u16(encoded.length),
      u16(stringOffset),
    ]));
    stringOffset += encoded.length;
  }
  const storage = Buffer.concat(strings);
  const header = Buffer.concat([
    u16(0),
    u16(records.length),
    u16(6 + records.length * 12),
  ]);
  return Buffer.concat([header, ...records, storage]);
}
