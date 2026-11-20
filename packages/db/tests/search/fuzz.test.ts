import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import { openMemory, seedKitchen, type SearchFixture } from "./fixture.js";

const ADVERSARIAL = [
  '"C-014" OR (foo*',
  "foo:bar",
  '""',
  "a",
  "ab",
  "C-01",
  "SI-212",
  "T07",
  "print rows",
  "cutoff rule",
  "OR NOT NEAR",
  "((((",
  "*:*",
  "foo AND bar OR NOT NEAR(x, y)",
  "' OR 1=1 --",
  "café",
  "a\u0000b",
  "NEAR(print, rows)",
  "title:print",
  '"',
  "'",
  "\\",
  "%_%",
  "C-014*",
  "NOT print",
];

const open: SearchFixture[] = [];

afterEach(() => {
  while (open.length > 0) open.pop()?.close();
});

describe("FTS5 query fuzz", () => {
  it("accepts 1,000 adversarial strings without an FTS5 syntax error", () => {
    const fixture = openMemory();
    open.push(fixture);
    seedKitchen(fixture);
    const samples = fc.oneof(
      { arbitrary: fc.string({ maxLength: 80 }), weight: 8 },
      { arbitrary: fc.constantFrom(...ADVERSARIAL), weight: 2 },
    );
    fc.assert(
      fc.property(samples, (query) => {
        const page = fixture.service.searchNodes({ query, limit: 99999 });
        expect(page.items.length).toBeLessThanOrEqual(500);
        const ident = fixture.service.searchByIdSubstring(query.slice(0, 64), { limit: 20 });
        expect(ident.items.length).toBeLessThanOrEqual(20);
        return true;
      }),
      { numRuns: 1000 },
    );
  });
});
