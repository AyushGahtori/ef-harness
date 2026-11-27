import { describe, expect, it } from "vitest";
import { StructuralDocumentChunker } from "../../src/extraction/chunker.js";
import { assembleNormalizedDocument } from "../../src/extraction/document.js";
import { EM_DASH } from "../../src/extraction/types.js";
import { textOfAboutTokens } from "../../src/extraction/tokens.js";

describe("StructuralDocumentChunker", () => {
  it("keeps every sentence locator aligned with the normalized document", () => {
    const document = assembleNormalizedDocument({
      sourceName: "PRD.pdf",
      pageCount: 4,
      sections: [
        {
          heading: "Checkout",
          page: 4,
          section: "3.2",
          paragraphs: ["Guest checkout is allowed for every visitor. Account holders skip the guest form."],
        },
      ],
    });
    const result = new StructuralDocumentChunker().chunk(document);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.chunks).toHaveLength(1);
    const chunk = result.chunks[0];
    expect(chunk?.headingPath).toEqual(["Checkout"]);
    for (const sentence of chunk?.sentences ?? []) {
      expect(document.text.slice(sentence.charStart, sentence.charEnd)).toBe(sentence.text);
      expect(sentence.page).toBe(4);
      expect(sentence.section).toBe("3.2");
    }
    expect(chunk?.sentences.some((sentence) => sentence.text.includes("Guest checkout"))).toBe(true);
  });

  it("packs large sections into 2000-4000 token chunks with 200 tokens of overlap", () => {
    const document = assembleNormalizedDocument({
      sourceName: "PRD.pdf",
      pageCount: 40,
      sections: [
        { heading: "Schedule", page: 3, paragraphs: [textOfAboutTokens(2500), "Cutoff is 11:00 AM."] },
        { heading: "Old appendix", page: 31, paragraphs: [textOfAboutTokens(2500), "Cutoff is 10:00 AM."] },
      ],
    });
    const result = new StructuralDocumentChunker().chunk(document);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.chunks.length).toBeGreaterThanOrEqual(2);
    for (const chunk of result.chunks) {
      expect(chunk.tokenCount).toBeGreaterThanOrEqual(2000);
      expect(chunk.tokenCount).toBeLessThanOrEqual(4000);
      for (const sentence of chunk.sentences) {
        expect(document.text.slice(sentence.charStart, sentence.charEnd)).toBe(sentence.text);
      }
    }
    const second = result.chunks[1];
    expect(second?.overlapTokenCount).toBeGreaterThan(0);
    expect(second?.overlapTokenCount).toBeLessThanOrEqual(200);
    expect(second?.sentences[0]?.overlap).toBe(true);
  });

  it("asks for a section selection on a 150-page document and extracts only the checked sections", () => {
    const chunker = new StructuralDocumentChunker();
    const document = assembleNormalizedDocument({
      sourceName: "RFP.pdf",
      pageCount: 150,
      sections: [
        { heading: "Section 1", page: 1, paragraphs: ["Cover notes."] },
        { heading: "Section 2", page: 10, endPage: 15, paragraphs: ["Scope of work."] },
        { heading: "Section 3", page: 16, paragraphs: ["Terms."] },
        { heading: "Section 4", page: 20, endPage: 26, paragraphs: ["Delivery plan."] },
        { heading: "Section 5", page: 30, endPage: 34, paragraphs: ["Pricing notes."] },
        { heading: "Section 6", page: 40, paragraphs: ["Appendix."] },
      ],
    });
    const blocked = chunker.chunk(document);
    expect(blocked.status).toBe("needs_selection");
    expect(blocked.chunks).toEqual([]);
    expect(chunker.formatSelection(document, ["2", "4", "5"])).toBe(`Sections 2, 4, 5 ${EM_DASH} ~18 pages`);
    const selected = chunker.chunk(document, { sectionIds: ["2", "4", "5"] });
    expect(selected.status).toBe("ready");
    if (selected.status !== "ready") return;
    const headings = selected.chunks.flatMap((chunk) =>
      chunk.sentences.filter((sentence) => sentence.blockKind === "heading").map((sentence) => sentence.text),
    );
    expect(headings).toEqual(["Section 2", "Section 4", "Section 5"]);
  });
});
