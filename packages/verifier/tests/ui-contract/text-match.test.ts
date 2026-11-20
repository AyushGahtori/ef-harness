import { describe, expect, it } from "vitest";
import { TextMatchNormalizer } from "../../src/ui-contract/index.js";

const normalizer = new TextMatchNormalizer();

describe("TextMatchNormalizer", () => {
  it("folds whitespace, case, quotes, apostrophes, and separators in normalized mode", () => {
    expect(normalizer.matches("Couldn\u2019t load orders", "Couldn't load orders")).toBe(true);
    expect(normalizer.matches("Couldn\u2018t", "Couldn't")).toBe(true);
    expect(normalizer.matches("\u201CPrint\u201D", '"Print"')).toBe(true);
    expect(normalizer.matches("Soup \u00B7 2", "Soup - 2")).toBe(true);
    expect(normalizer.matches("Soup \u2013 2", "Soup \u2014 2")).toBe(true);
    expect(normalizer.matches("Soup | 2", "Soup - 2")).toBe(true);
    expect(normalizer.matches("  Print   LIST  ", "print list")).toBe(true);
    expect(normalizer.matches("a-b", "a\u00B7b")).toBe(true);
    expect(normalizer.matches("a\u2013b", "a|b")).toBe(true);
  });

  it("rejects a different word even when the surrounding punctuation matches", () => {
    expect(normalizer.matches("Couldn't load orders", "Could not load orders")).toBe(false);
    expect(normalizer.matches("Couldn't load orders \u00B7 Retry", "Could not load orders - Retry")).toBe(false);
    expect(normalizer.matches("Soup \u00B7 2", "Soup \u00B7 9")).toBe(false);
  });

  it("compares exact mode byte for byte", () => {
    expect(normalizer.matches("Couldn't", "Couldn't", "exact")).toBe(true);
    expect(normalizer.matches("Couldn\u2019t", "Couldn't", "exact")).toBe(false);
    expect(normalizer.matches("Soup \u00B7 2", "Soup - 2", "exact")).toBe(false);
    expect(normalizer.matches("$12.00", "$12.00", "exact")).toBe(true);
    expect(normalizer.matches("$12.00", "$12", "exact")).toBe(false);
  });

  it("checks that a contains phrase is present after normalization", () => {
    expect(
      normalizer.matches("Couldn\u2019t load orders. Try the desk copy.", "load orders", "contains"),
    ).toBe(true);
    expect(normalizer.matches("Couldn't load orders", "Could not", "contains")).toBe(false);
    expect(normalizer.matches("Print the kitchen list", "kitchen list", "contains")).toBe(true);
  });
});
