import { describe, expect, it } from "vitest";
import { AGENT_TAG_MAX_CHARS, formatAgentOfficeTag, rankOutfitFor } from "../../src/office/cast/index.js";
import { makeWorker } from "./fixtures.js";

describe("formatAgentOfficeTag", () => {
  it("matches Task 124 A0014 · print page formatting", () => {
    const tag = formatAgentOfficeTag("A0014", "print page");
    expect(tag.text).toBe("A0014 · print page");
    expect(tag.fullTitle).toBe("print page");
    expect(tag.text.length).toBeLessThanOrEqual(AGENT_TAG_MAX_CHARS);
  });

  it("abbreviates the canonical long kitchen print title", () => {
    const long = "Implement responsive printable kitchen daily meal summary page";
    const tag = formatAgentOfficeTag("A0014", long);
    expect(tag.text).toBe("A0014 · print page");
    expect(tag.fullTitle).toBe(long);
  });

  it("clamps tags to 22 characters", () => {
    const tag = formatAgentOfficeTag("A0014", "print the kitchen ticket");
    expect(tag.text.length).toBeLessThanOrEqual(AGENT_TAG_MAX_CHARS);
    expect(tag.fullTitle).toBe("A0014 · print the kitchen ticket".slice(7) ? "print the kitchen ticket" : tag.fullTitle);
    expect(tag.fullTitle).toBe("print the kitchen ticket");
    expect(tag.text.endsWith("…") || tag.text.length === AGENT_TAG_MAX_CHARS).toBe(true);
  });
});

describe("rank outfits", () => {
  it("reflects Jr/Mid/Sr/Principal tiers", () => {
    expect(rankOutfitFor(makeWorker({ tier: "junior" })).tierLabel).toBe("Jr");
    expect(rankOutfitFor(makeWorker({ tier: "mid" })).tierLabel).toBe("Mid");
    expect(rankOutfitFor(makeWorker({ tier: "senior" })).tierLabel).toBe("Sr");
    expect(
      rankOutfitFor(makeWorker({ tier: "architect", role: "architect" })).props,
    ).toContain("scarf");
    expect(
      rankOutfitFor(makeWorker({ tier: "integrator", role: "integrator" })).props,
    ).toContain("hard-hat");
  });
});