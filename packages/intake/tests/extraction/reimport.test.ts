import { describe, expect, it } from "vitest";
import { assembleNormalizedDocument } from "../../src/extraction/document.js";
import { FakeModelAdapter } from "../../src/extraction/fake-model.js";
import { IntakeExtractionPipeline } from "../../src/extraction/pipeline.js";

describe("re-import diff mode", () => {
  it("extracts only modified and new sections and feeds the deltas to hybrid revision", () => {
    const previous = assembleNormalizedDocument({
      sourceName: "PRD-v1.pdf",
      pageCount: 6,
      sections: [
        { heading: "Intro", page: 1, paragraphs: ["Unchanged intro sentence stays."] },
        { heading: "Menu", page: 2, paragraphs: ["The menu lists sandwiches."] },
        { heading: "Dropped", page: 3, paragraphs: ["This section is gone in v2."] },
      ],
    });
    const next = assembleNormalizedDocument({
      sourceName: "PRD-v2.pdf",
      pageCount: 6,
      sections: [
        { heading: "Intro", page: 1, paragraphs: ["Unchanged intro sentence stays."] },
        { heading: "Menu", page: 2, paragraphs: ["Menu now includes salads."] },
        { heading: "Allergens", page: 4, paragraphs: ["Brand new allergen section."] },
      ],
    });
    const model = new FakeModelAdapter(() => JSON.stringify({ statements: [], suspicious_instructions: [] }));
    const result = new IntakeExtractionPipeline().reimport({ previous, next, model });
    const prompts = model.calls.map((call) => call.prompt).join("\n");
    expect(prompts).not.toContain("Unchanged intro sentence stays.");
    expect(prompts).toContain("Menu now includes salads.");
    expect(prompts).toContain("Brand new allergen section.");
    expect(result.skippedSectionKeys).toContain("Intro");
    expect(result.extractedSectionKeys).toEqual(["Menu", "Allergens"]);
    expect(result.feed.target).toBe("task-087");
    expect(result.feed.contract).toBe("hybrid-revision");
    expect(result.feed.deltas.map((delta) => delta.change).sort()).toEqual(["added", "modified", "removed"]);
    expect(result.feed.deltas.some((delta) => delta.change === "removed" && delta.sectionKey === "Dropped")).toBe(true);
    expect(model.calls.every((call) => call.tools.length === 0)).toBe(true);
  });
});
