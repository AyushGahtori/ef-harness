import { describe, expect, it } from "vitest";
import { DocxConverter, verifyBlockQuote } from "../../src/converters/index.js";
import { createCanonicalHash } from "../../src/converters/ports/canonical-hash.js";
import { buildDocx, documentXml, paragraphXml, tableXml } from "./fixtures.js";

const hash = createCanonicalHash();

describe("DOCX converter", () => {
  it("emits paragraph indexes, headings, and table cells", async () => {
    const xml = documentXml(
      [
        paragraphXml("Overview", "Heading1"),
        paragraphXml("Orders placed after 10:45 are moved."),
        tableXml([
          ["Name", "Qty"],
          ["Soup", "2"],
        ]),
      ].join(""),
    );
    const bytes = buildDocx(xml);
    const result = await new DocxConverter().convert(bytes, "spec.docx", hash.sha256Prefixed(bytes));
    expect(result.engines).toContain("mammoth");
    expect(result.document.blocks.map((block) => [block.kind, block.text, block.locator])).toEqual([
      ["heading", "Overview", { type: "docx", sectionHeading: "Overview", paragraphIndex: 1 }],
      [
        "paragraph",
        "Orders placed after 10:45 are moved.",
        { type: "docx", sectionHeading: "Overview", paragraphIndex: 2 },
      ],
      [
        "table_cell",
        "Name",
        { type: "docx", sectionHeading: "Overview", paragraphIndex: 3, tableCell: [0, 0] },
      ],
      [
        "table_cell",
        "Qty",
        { type: "docx", sectionHeading: "Overview", paragraphIndex: 4, tableCell: [0, 1] },
      ],
      [
        "table_cell",
        "Soup",
        { type: "docx", sectionHeading: "Overview", paragraphIndex: 5, tableCell: [1, 0] },
      ],
      [
        "table_cell",
        "2",
        { type: "docx", sectionHeading: "Overview", paragraphIndex: 6, tableCell: [1, 1] },
      ],
    ]);
    for (const block of result.document.blocks) {
      expect(verifyBlockQuote(result.document, block)).toBe(true);
    }
  }, 30_000);

  it("strips XXE entities and macros", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///C:/Windows/win.ini">]>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Safe paragraph</w:t></w:r></w:p>
    <w:p><w:r><w:t>&xxe;</w:t></w:r></w:p>
  </w:body>
</w:document>`;
    const bytes = buildDocx(xml, [{ name: "word/vbaProject.bin", data: Buffer.from("macro-bytes") }]);
    const result = await new DocxConverter().convert(bytes, "evil.docx", hash.sha256Prefixed(bytes));
    expect(result.document.text).toContain("Safe paragraph");
    expect(result.document.text).not.toContain("win.ini");
    expect(result.document.text.toLowerCase()).not.toContain("for 16-bit");
    expect(result.document.text).not.toContain("macro-bytes");
    expect(result.document.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(["xxe_blocked", "macros_stripped"]),
    );
  }, 30_000);
});
