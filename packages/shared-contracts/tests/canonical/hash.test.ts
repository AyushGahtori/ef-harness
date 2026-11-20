import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CONTENT_HASH_PREFIX,
  canonicalizeJson,
  computeNodeContentHash,
  computeRequestHash,
  computeResultSetHash,
  computeSearchQueryHash,
  normalizeNfc,
} from "../../src/canonical/index.js";

function referenceDigest(value: unknown): string {
  const text = canonicalizeJson(normalizeNfc(value));
  return `${CONTENT_HASH_PREFIX}${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

describe("content, request, and search hashes", () => {
  const node = {
    kind: "rule",
    title: "Cutoff",
    text: "Orders close at 10:45",
    fields: { feature: "F12", when: "10:45" },
  };

  it("prefixes lowercase sha256 and hashes only kind, title, text, and fields", () => {
    const digest = computeNodeContentHash(node);
    expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(digest).toBe(referenceDigest(node));
    expect(computeNodeContentHash({ ...node, fields: undefined })).toBe(
      computeNodeContentHash({ ...node, fields: {} }),
    );
    expect(
      computeNodeContentHash({
        ...node,
        extra: true,
      } as typeof node),
    ).toBe(digest);
  });

  it("is identical for shuffled keys, NFD versus NFC, and -0 versus 0", () => {
    const nfd = "Cafe\u0301";
    const nfc = "Caf\u00e9";
    const left = computeNodeContentHash({
      text: nfd,
      fields: { zeta: -0, alpha: nfd },
      title: nfd,
      kind: "rule",
    });
    const right = computeNodeContentHash({
      kind: "rule",
      title: nfc,
      text: nfc,
      fields: { alpha: nfc, zeta: 0 },
    });
    expect(left).toBe(right);
    expect(left).not.toBe(
      computeNodeContentHash({
        kind: "rule",
        title: nfc,
        text: "other",
        fields: { alpha: nfc, zeta: 0 },
      }),
    );
  });

  it("hashes requests independently of key order", () => {
    const first = computeRequestHash({ op: "edit", payload: { b: 1, a: "e\u0301" } });
    const second = computeRequestHash({ payload: { a: "\u00e9", b: 1 }, op: "edit" });
    expect(first).toBe(second);
    expect(first).not.toBe(computeRequestHash({ op: "edit", payload: { b: 2, a: "\u00e9" } }));
  });

  it("hashes canonical { query, filters } and ignores extra properties", () => {
    const digest = computeSearchQueryHash({
      filters: { kind: "rule", feature: "F12" },
      query: "print rows",
    });
    expect(digest).toBe(
      computeSearchQueryHash({
        query: "print rows",
        filters: { feature: "F12", kind: "rule" },
        unused: true,
      } as { query: string; filters: { kind: string; feature: string } }),
    );
    expect(digest).not.toBe(computeSearchQueryHash({ query: "print", filters: { kind: "rule" } }));
  });

  it("gives the empty result set a stable hash distinct from any hit and ignores order", () => {
    const empty = computeResultSetHash([]);
    const one = computeResultSetHash([{ id: "A", version: 1 }]);
    expect(empty).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(empty).not.toBe(one);
    expect(computeResultSetHash([])).toBe(empty);
    const input = [
      { id: "B", version: 1 },
      { id: "A", version: 2 },
    ];
    const snapshot = input.map((entry) => ({ ...entry }));
    expect(computeResultSetHash(input)).toBe(
      computeResultSetHash([
        { id: "A", version: 2 },
        { id: "B", version: 1 },
      ]),
    );
    expect(input).toEqual(snapshot);
    expect(computeResultSetHash([{ id: "A", version: 1 }])).not.toBe(
      computeResultSetHash([{ id: "A", version: 2 }]),
    );
  });
});
