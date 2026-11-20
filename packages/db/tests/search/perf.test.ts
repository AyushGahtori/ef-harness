import { afterEach, describe, expect, it } from "vitest";
import { openMemory, type SearchFixture } from "./fixture.js";

const open: SearchFixture[] = [];

afterEach(() => {
  while (open.length > 0) open.pop()?.close();
});

describe("search performance", () => {
  it(
    "searches and lists 5,000 requirements plus 500 tasks under the 200 ms UI budget",
    () => {
      const fixture = openMemory();
      open.push(fixture);
      const requirements = Array.from({ length: 5000 }, (_, index) => ({
        id: `SI-${index + 1}`,
        kind: "spec_item",
        title: `Requirement ${index + 1}`,
        text: index === 17 ? "Orders close at 10:45 and export CSV" : "A settled requirement",
        fields: { feature: "F12", tags: index % 2 === 0 ? ["print"] : ["api"] },
      }));
      const tasks = Array.from({ length: 500 }, (_, index) => ({
        id: `T${index + 1}`,
        kind: "task",
        title: index === 3 ? "Map totals with toPrintRows" : `Task ${index + 1}`,
        fields: { feature: "F12" },
      }));
      fixture.addNodes(requirements);
      fixture.addNodes(tasks);

      const searchStarted = performance.now();
      const found = fixture.service.searchNodes({ query: "print rows", limit: 20 });
      const searchMs = performance.now() - searchStarted;
      expect(found.items.map((item) => item.id)).toContain("T4");
      expect(searchMs).toBeLessThan(200);

      const listStarted = performance.now();
      const page = fixture.service.listNodesPaginated({ limit: 500, kinds: ["spec_item"], feature: "F12" });
      const listMs = performance.now() - listStarted;
      expect(page.items).toHaveLength(500);
      expect(page.hasMore).toBe(true);
      expect(listMs).toBeLessThan(200);
    },
    60_000,
  );
});
