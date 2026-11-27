import { describe, expect, it } from "vitest";
import {
  FileExpansionLimitError,
  FileSizeLimitError,
  PasswordRequiredError,
  SandboxedDocumentConverter,
  UnsupportedOrMismatchedFileType,
  formatLocatorCitation,
  verifyBlockQuote,
} from "../../src/converters/index.js";
import { MemoryCasBlobStore } from "../../src/converters/ports/cas-blob-store.js";
import { MAX_RAW_FILE_BYTES } from "../../src/converters/limits.js";
import { renderBitmapText } from "../../src/converters/bitmap-font.js";
import {
  buildDocx,
  buildPdf,
  declaredExpansionZip,
  documentXml,
  paragraphXml,
  streamingExpansionZip,
} from "./fixtures.js";

function digitalPdf(): Uint8Array {
  return buildPdf([
    {
      content: [
        "BT",
        "/F1 16 Tf",
        "0 0 0 rg",
        "72 720 Td",
        "(Lunch ordering) Tj",
        "0 -24 Td",
        "/F1 12 Tf",
        "(Orders placed after 10:45 are moved.) Tj",
        "ET",
      ].join("\n"),
    },
  ]);
}

describe("sandboxed document converter", () => {
  it("converts inside a zero-network child and cites exact locators", async () => {
    const bytes = digitalPdf();
    const converter = new SandboxedDocumentConverter();
    const result = await converter.convert({ fileName: "PRD.pdf", bytes });
    expect(result.cacheHit).toBe(false);
    expect(result.sandbox.executed).toBe(true);
    expect(result.sandbox.zeroNetwork).toBe(true);
    expect(result.sandbox.networkDenied).toBe(true);
    expect(result.sandbox.pid).not.toBe(process.pid);
    expect(result.sandbox.memoryLimitBytes).toBe(512 * 1024 * 1024);
    expect(result.sandbox.wallClockMs).toBe(30_000);
    expect(result.sandbox.jobAssigned).toBe(true);
    expect(result.engines).toContain("pdf.js");
    expect(result.document.text).toContain("Orders placed after 10:45 are moved.");
    const quote = result.document.blocks[1];
    expect(quote).toBeDefined();
    if (!quote) return;
    expect(verifyBlockQuote(result.document, quote)).toBe(true);
    expect(formatLocatorCitation("PRD.pdf", quote.locator)).toBe("PRD.pdf p.1 ¶2");
    const persisted = await new MemoryCasBlobStore().readNormalized("missing");
    expect(persisted).toBeNull();
  }, 40_000);

  it("returns the cached normalized document for identical bytes", async () => {
    const bytes = digitalPdf();
    const converter = new SandboxedDocumentConverter();
    const first = await converter.convert({ fileName: "PRD.pdf", bytes });
    const second = await converter.convert({ fileName: "PRD.pdf", bytes });
    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(second.sandbox.executed).toBe(false);
    expect(second.document).toEqual(first.document);
    expect(second.engines).toEqual(["cache"]);
  }, 40_000);

  it("rejects an executable renamed to pdf before parsing", async () => {
    const converter = new SandboxedDocumentConverter();
    await expect(
      converter.convert({ fileName: "spec.pdf", bytes: Buffer.from("MZ\u0090\u0000not-a-pdf") }),
    ).rejects.toBeInstanceOf(UnsupportedOrMismatchedFileType);
  });

  it("rejects a declared zip bomb and a streaming expansion bomb", async () => {
    const converter = new SandboxedDocumentConverter();
    await expect(
      converter.convert({ fileName: "bomb.docx", bytes: declaredExpansionZip(4_000_000_000) }),
    ).rejects.toBeInstanceOf(FileExpansionLimitError);
    await expect(
      converter.convert({ fileName: "expand.docx", bytes: streamingExpansionZip() }),
    ).rejects.toBeInstanceOf(FileExpansionLimitError);
  }, 40_000);

  it("blocks XXE inside the child process", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///C:/Windows/win.ini">]>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>Safe paragraph &xxe;</w:t></w:r></w:p></w:body>
</w:document>`;
    const result = await new SandboxedDocumentConverter().convert({
      fileName: "xxe.docx",
      bytes: buildDocx(xml),
    });
    expect(result.sandbox.executed).toBe(true);
    expect(result.sandbox.networkDenied).toBe(true);
    expect(result.document.text).toContain("Safe paragraph");
    expect(result.document.text).not.toContain("win.ini");
    expect(result.document.warnings.some((warning) => warning.code === "xxe_blocked")).toBe(true);
  }, 40_000);

  it("reports a password-protected PDF without crashing the parent", async () => {
    const bytes = buildPdf([{ content: "BT /F1 12 Tf 72 720 Td (Secret) Tj ET" }], { encrypt: true });
    const converter = new SandboxedDocumentConverter();
    await expect(converter.convert({ fileName: "locked.pdf", bytes })).rejects.toBeInstanceOf(PasswordRequiredError);
    expect(converter).toBeInstanceOf(SandboxedDocumentConverter);
  }, 40_000);

  it("strips bidi override characters from markdown in the child", async () => {
    const text = `Visible plan\u202e\u2066 secret`;
    const result = await new SandboxedDocumentConverter().convert({
      fileName: "notes.md",
      bytes: Buffer.from(text),
    });
    expect(result.document.text).toBe("Visible plan secret");
    expect(result.document.warnings.some((warning) => warning.code === "stealth_unicode_stripped")).toBe(true);
  }, 40_000);

  it("OCRs a dropped PNG and stores a vision summary ref when a captioner is supplied", async () => {
    const raster = renderBitmapText("HELLO");
    const { encodePng } = await import("../../src/converters/png-codec.js");
    const result = await new SandboxedDocumentConverter().convert({
      fileName: "board.png",
      bytes: encodePng(raster),
      visionCaptioner: {
        async caption() {
          return { summary: "A whiteboard greeting", ref: "sha256:vision" };
        },
      },
    });
    expect(result.document.text).toBe("HELLO");
    const locator = result.document.blocks[0]?.locator;
    expect(locator?.type).toBe("image");
    if (locator?.type === "image") expect(locator.visionSummaryRef).toBe("sha256:vision");
  }, 40_000);

  it("leaves the vision summary unset when no captioner is supplied", async () => {
    const raster = renderBitmapText("HELLO");
    const { encodePng } = await import("../../src/converters/png-codec.js");
    const result = await new SandboxedDocumentConverter().convert({
      fileName: "board.png",
      bytes: encodePng(raster),
    });
    const locator = result.document.blocks[0]?.locator;
    expect(locator?.type).toBe("image");
    if (locator?.type === "image") expect(locator.visionSummaryRef).toBeUndefined();
  }, 40_000);

  it("rejects a raw file above 50 MB before spawning", async () => {
    const bytes = Buffer.alloc(MAX_RAW_FILE_BYTES + 1);
    const converter = new SandboxedDocumentConverter();
    await expect(converter.convert({ fileName: "big.pdf", bytes })).rejects.toBeInstanceOf(FileSizeLimitError);
  });

  it("keeps a docx paragraph quote aligned after sandbox persistence", async () => {
    const bytes = buildDocx(documentXml(paragraphXml("Orders move overnight.")));
    const result = await new SandboxedDocumentConverter().convert({ fileName: "note.docx", bytes });
    expect(result.engines).toContain("mammoth");
    const block = result.document.blocks[0];
    expect(block?.text).toBe("Orders move overnight.");
    if (!block) return;
    expect(verifyBlockQuote(result.document, block)).toBe(true);
    expect(formatLocatorCitation("note.docx", block.locator)).toBe("note.docx ¶1");
  }, 40_000);
});
