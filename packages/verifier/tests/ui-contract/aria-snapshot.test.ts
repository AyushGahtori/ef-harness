import { describe, expect, it } from "vitest";
import {
  classifySeededRows,
  matchAriaSnapshot,
  seededRowsFromSnapshot,
  toMatchAriaSnapshot,
} from "../../src/ui-contract/index.js";

const ACTUAL = `
- navigation "Primary":
  - link "Orders"
- main:
  - heading "Kitchen totals" [level=1]
  - table "Totals by dish":
    - rowgroup:
      - row "Dish Quantity":
        - columnheader "Dish"
        - columnheader "Quantity"
    - rowgroup:
      - row "Soup 2":
        - cell "Soup"
        - cell "2"
      - row "Rice 1":
        - cell "Rice"
        - cell "1"
  - button "Print"
`;

describe("ARIA snapshots", () => {
  it("matches a partial ordered snapshot and a dynamic order regex", () => {
    const partial = matchAriaSnapshot(
      ACTUAL,
      `
      - main:
        - heading "Kitchen totals"
        - table "Totals by dish":
          - rowgroup:
            - row:
              - cell "Soup"
              - cell "2"
        - button "Print"
      `,
    );
    expect(partial.ok).toBe(true);
    const dynamic = matchAriaSnapshot(
      `
      - table "Orders":
        - rowgroup:
          - 'row "Order #17"':
            - 'cell "Order #17"'
      `,
      `
      - table "Orders":
        - rowgroup:
          - row:
            - cell /Order #\\d+/
      `,
    );
    expect(dynamic.ok).toBe(true);
  });

  it("is order sensitive and rejects a different cell", () => {
    expect(
      matchAriaSnapshot(
        '- row:\n  - cell "Quantity"\n  - cell "Dish"\n',
        '- row:\n  - cell "Dish"\n  - cell "Quantity"\n',
      ).ok,
    ).toBe(false);
    expect(matchAriaSnapshot(ACTUAL, '- cell "9"').ok).toBe(false);
  });

  it("reads seeded dish rows and classifies mismatches without echoing expectations", () => {
    expect(seededRowsFromSnapshot(ACTUAL, ["Dish", "Quantity"])).toEqual(["Soup · 2", "Rice · 1"]);
    expect(classifySeededRows(["Soup · 2", "Rice · 1"], ["Soup - 2", "Rice | 1"]).ok).toBe(true);
    const wrong = classifySeededRows(["Soup · 9", "Rice · 8"], ["Soup · 2", "Rice · 1"]);
    expect(wrong).toEqual({ ok: false, failureType: "wrong_value" });
    expect(classifySeededRows(["Rice · 1", "Soup · 2"], ["Soup · 2", "Rice · 1"])).toEqual({
      ok: false,
      failureType: "wrong_order",
    });
  });

  it("runs toMatchAriaSnapshot against a reader", async () => {
    const comparison = await toMatchAriaSnapshot(
      { ariaSnapshot: async () => ACTUAL },
      '- main:\n  - button "Print"\n',
    );
    expect(comparison.ok).toBe(true);
    expect(comparison.actual).toContain("Print");
  });
});
