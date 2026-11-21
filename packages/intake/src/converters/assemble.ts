import { stableJson } from "./ports/canonical-hash.js";
import { stealthWarning, stripStealthUnicode } from "./unicode-sanitizer.js";
import type {
  ConverterWarning,
  MediaType,
  NormalizedBlock,
  NormalizedDocument,
  NormalizedStats,
  RawBlock,
} from "./types.js";

export function assembleDocument(input: {
  readonly sourceHash: string;
  readonly fileName: string;
  readonly mediaType: MediaType;
  readonly blocks: readonly RawBlock[];
  readonly warnings: readonly ConverterWarning[];
  readonly ocrDerived: boolean;
  readonly stats: Omit<NormalizedStats, "charCount">;
}): NormalizedDocument {
  const warnings = [...input.warnings];
  let text = "";
  let utf8 = 0;
  let stripped = false;
  const blocks: NormalizedBlock[] = [];
  input.blocks.forEach((block, index) => {
    const clean = stripStealthUnicode(block.text);
    if (clean.stripped) stripped = true;
    if (index > 0) {
      text += "\n";
      utf8 += 1;
    }
    const charStart = text.length;
    const utf8ByteStart = utf8;
    text += clean.text;
    const bytes = Buffer.byteLength(clean.text, "utf8");
    utf8 += bytes;
    blocks.push({
      id: `b${index + 1}`,
      kind: block.kind,
      text: clean.text,
      charStart,
      charEnd: text.length,
      utf8ByteStart,
      utf8ByteEnd: utf8,
      locator: block.locator,
    });
  });
  if (stripped && !warnings.some((warning) => warning.code === "stealth_unicode_stripped")) {
    warnings.push(stealthWarning());
  }
  const stats: NormalizedStats = {
    charCount: text.length,
    ...(input.stats.pageCount !== undefined ? { pageCount: input.stats.pageCount } : {}),
    ...(input.stats.totalRows !== undefined ? { totalRows: input.stats.totalRows } : {}),
    ...(input.stats.width !== undefined ? { width: input.stats.width } : {}),
    ...(input.stats.height !== undefined ? { height: input.stats.height } : {}),
  };
  return {
    schema: "normalized-document@1",
    sourceHash: input.sourceHash,
    fileName: input.fileName,
    mediaType: input.mediaType,
    text,
    blocks,
    warnings,
    ocrDerived: input.ocrDerived,
    stats,
  };
}

export function serializeDocument(document: NormalizedDocument): Uint8Array {
  return Buffer.from(stableJson(document), "utf8");
}

export function deserializeDocument(bytes: Uint8Array): NormalizedDocument {
  return JSON.parse(Buffer.from(bytes).toString("utf8")) as NormalizedDocument;
}
