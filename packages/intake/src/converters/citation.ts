import type { DocumentLocator, NormalizedBlock, NormalizedDocument } from "./types.js";

export function formatLocatorCitation(fileName: string, locator: DocumentLocator): string {
  switch (locator.type) {
    case "pdf":
      return `${fileName} p.${locator.page} ¶${locator.lineStart}`;
    case "pdf_ocr":
      return `${fileName} p.${locator.page} ¶ocr`;
    case "docx":
      return `${fileName} ¶${locator.paragraphIndex}`;
    case "markdown":
    case "html":
      return `${fileName} L${locator.lineStart}-L${locator.lineEnd}`;
    case "csv":
      return `${fileName} r${locator.rowStart}-r${locator.rowEnd}`;
    case "image":
      return `${fileName} image`;
    default: {
      const unreachable: never = locator;
      return unreachable;
    }
  }
}

export function verifyBlockQuote(document: NormalizedDocument, block: NormalizedBlock): boolean {
  if (document.text.slice(block.charStart, block.charEnd) !== block.text) return false;
  const encoded = Buffer.from(document.text, "utf8");
  const slice = encoded.subarray(block.utf8ByteStart, block.utf8ByteEnd).toString("utf8");
  return slice === block.text;
}
