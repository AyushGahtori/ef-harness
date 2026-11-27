import { describe, expect, it } from "vitest";
import { selectLoadedCorpusBatch } from "../../src/session/corpus-adaptive.js";

describe("adaptive selector over the v1 corpus", () => {
  it("selects a batch from all 87 bundled questions", () => {
    const selected = selectLoadedCorpusBatch(3);
    expect(selected.questionCount).toBe(87);
    expect(selected.selectedIds.length).toBeGreaterThan(0);
    expect(selected.selectedIds.length).toBeLessThanOrEqual(3);
    expect(new Set(selected.selectedIds).size).toBe(selected.selectedIds.length);
  });
});
