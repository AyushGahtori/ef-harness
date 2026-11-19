import { afterEach, describe, expect, it } from "vitest";
import { decodeKeysetCursor, encodeKeysetCursor } from "../../src/search/cursor.js";
import { InvalidCursorError } from "../../src/search/errors.js";
import { SEARCH_PAGE_MAX } from "../../src/search/filters.js";
import { openMemory, type SearchFixture } from "./fixture.js";

const open: SearchFixture[] = [];

afterEach(() => {
  while (open.length > 0) open.pop()?.close();
});

describe("keyset pagination", () => {
  it("returns disjoint 500-row pages over 1,200 nodes with no skips", () => {
    const fixture = openMemory();
    open.push(fixture);
    const total = 1200;
    fixture.addNodes(
      Array.from({ length: total }, (_, index) => ({
        id: `N${String(index + 1).padStart(4, "0")}`,
        kind: "spec_item",
        title: `Requirement ${index + 1}`,
        fields: { feature: "F12" },
      })),
    );
    fixture.addNodes([
      { id: "RETIRED", kind: "spec_item", title: "Retired requirement", fields: { feature: "F12" } },
    ]);
    fixture.retire("RETIRED");

    const seen = new Set<string>();
    const nids: number[] = [];
    let cursor: string | undefined;
    let pages = 0;
    for (;;) {
      const page = fixture.service.listNodesPaginated(
        cursor === undefined ? { limit: 99999 } : { limit: 99999, cursor },
      );
      expect(page.items.length).toBeLessThanOrEqual(SEARCH_PAGE_MAX);
      expect(page.items.length).toBeGreaterThan(0);
      for (const item of page.items) {
        expect(seen.has(item.id)).toBe(false);
        seen.add(item.id);
        const previous = nids[nids.length - 1];
        if (previous !== undefined) expect(item.nid).toBeGreaterThan(previous);
        nids.push(item.nid);
      }
      pages += 1;
      if (!page.hasMore) {
        expect(page.nextCursor).toBeNull();
        break;
      }
      expect(page.nextCursor).toEqual(expect.any(String));
      cursor = page.nextCursor ?? undefined;
      expect(pages).toBeLessThan(10);
    }
    expect(pages).toBe(3);
    expect(seen.size).toBe(total);
    expect(nids).toHaveLength(total);
    expect(seen.has("RETIRED")).toBe(false);
  });

  it("clamps limits into [1, 500] and rejects malformed cursors", () => {
    const fixture = openMemory();
    open.push(fixture);
    fixture.addNodes([
      { id: "A1", kind: "rule", title: "One", fields: { feature: "F12" } },
      { id: "A2", kind: "rule", title: "Two", fields: { feature: "F12" } },
      { id: "A3", kind: "rule", title: "Three", fields: { feature: "F12" } },
    ]);
    expect(fixture.service.listNodesPaginated({ limit: 0 }).items).toHaveLength(1);
    expect(fixture.service.listNodesPaginated({ limit: -4 }).items).toHaveLength(1);
    expect(fixture.service.searchNodes({ query: "one", limit: 99999 }).items.length).toBeLessThanOrEqual(500);

    expect(() => fixture.service.listNodesPaginated({ cursor: "@@@" })).toThrow(InvalidCursorError);
    expect(() => fixture.service.listNodesPaginated({ cursor: "not-a-cursor" })).toThrow(InvalidCursorError);
    const zero = Buffer.from(JSON.stringify({ v: 1, nid: 0 }), "utf8").toString("base64url");
    const fraction = Buffer.from(JSON.stringify({ v: 1, nid: 1.5 }), "utf8").toString("base64url");
    const array = Buffer.from("[]", "utf8").toString("base64url");
    expect(() => fixture.service.listNodesPaginated({ cursor: zero })).toThrow(InvalidCursorError);
    expect(() => fixture.service.listNodesPaginated({ cursor: fraction })).toThrow(InvalidCursorError);
    expect(() => fixture.service.listNodesPaginated({ cursor: array })).toThrow(InvalidCursorError);

    const first = fixture.service.listNodesPaginated({ limit: 1 });
    const cursor = first.nextCursor;
    if (!cursor) throw new Error("expected a cursor");
    const nid = decodeKeysetCursor(cursor);
    fixture.retire(first.items[0]?.id ?? "");
    const next = fixture.service.listNodesPaginated({ limit: 10, cursor });
    expect(next.items.every((item) => item.nid > nid)).toBe(true);
    expect(next.items.map((item) => item.id)).not.toContain(first.items[0]?.id);

    const past = encodeKeysetCursor(1_000_000);
    const empty = fixture.service.listNodesPaginated({ cursor: past });
    expect(empty.items).toEqual([]);
    expect(empty.hasMore).toBe(false);
    expect(empty.nextCursor).toBeNull();
  });
});
