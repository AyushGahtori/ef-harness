import { dispatchFile } from "./magic-bytes.js";
import { CsvTsvConverter } from "./csv-tsv-converter.js";
import { DocxConverter } from "./docx-converter.js";
import { ImageOcrVisionConverter } from "./image-ocr-converter.js";
import { MarkdownHtmlConverter } from "./markdown-html-converter.js";
import { PdfConverter } from "./pdf-converter.js";
import type { NormalizedDocument } from "./types.js";

export interface EngineResult {
  readonly document: NormalizedDocument;
  readonly engines: readonly string[];
}

export interface ByteConvertOptions {
  readonly pageStart?: number;
  readonly pageEnd?: number;
}

const pdfConverter = new PdfConverter();
const docxConverter = new DocxConverter();
const markupConverter = new MarkdownHtmlConverter();
const csvConverter = new CsvTsvConverter();
const imageConverter = new ImageOcrVisionConverter();

export async function convertBytes(
  bytes: Uint8Array,
  fileName: string,
  sourceHash: string,
  options: ByteConvertOptions = {},
): Promise<EngineResult> {
  const kind = dispatchFile(bytes, fileName);
  switch (kind) {
    case "pdf":
      return {
        engines: ["pdf.js"],
        document: await pdfConverter.convert(bytes, fileName, sourceHash, options),
      };
    case "docx":
      return docxConverter.convert(bytes, fileName, sourceHash);
    case "markdown":
      return {
        engines: ["markdown"],
        document: markupConverter.convert(bytes, fileName, sourceHash, "markdown"),
      };
    case "html":
      return {
        engines: ["html"],
        document: markupConverter.convert(bytes, fileName, sourceHash, "html"),
      };
    case "csv":
    case "tsv":
      return {
        engines: [kind],
        document: csvConverter.convert(bytes, fileName, sourceHash, kind),
      };
    case "png":
    case "jpeg":
    case "webp":
      return {
        engines: ["image-ocr"],
        document: await imageConverter.convert(bytes, fileName, sourceHash),
      };
    default: {
      const unreachable: never = kind;
      throw new Error(`Unsupported dispatch kind: ${String(unreachable)}`);
    }
  }
}

export { PdfConverter, DocxConverter, MarkdownHtmlConverter, CsvTsvConverter, ImageOcrVisionConverter };
