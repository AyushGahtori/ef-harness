import { describe, expect, it } from "vitest";

import {
  LostKeyOracleRegenerator,
  OrphanBranchRehydrator,
  type IndependentOracleAuthorSealerPort,
} from "../../src/rehydration/index.js";
import { createHarnessFixture } from "./fixtures.js";

const sealer: IndependentOracleAuthorSealerPort = {
  async regenerateSealedChecksFromSpecs(input) {
    return [
      {
        featureId: "F-12",
        path: "checks-sealed/F-12.age",
        ageContent: `regenerated:${input.projectId}`,
      },
    ];
  },
};

describe("lost-key oracle regenerator", () => {
  it("rehydrates specs without crashing and offers regeneration when age key is absent", async () => {
    const fixture = await createHarnessFixture();
    const rehydrator = new OrphanBranchRehydrator(fixture.laptopBPath);
    const result = await rehydrator.rehydrate();
    expect(result.graph.entities.length).toBeGreaterThan(0);
    expect(result.undecryptableCheckPaths).toContain("checks-sealed/F-12.age");

    const regenerator = new LostKeyOracleRegenerator(sealer);
    const card = regenerator.buildCard(result);
    expect(card?.canRegenerateFromSpecs).toBe(true);

    const regenerated = await regenerator.regenerateFromSpecs(result.graph, "age1public");
    expect(regenerated[0]?.ageContent).toContain("proj-cafe");
  }, 60_000);
});