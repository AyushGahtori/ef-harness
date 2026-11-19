import { afterEach, describe, expect, it } from "vitest";
import { computeResultSetHash } from "../../src/search/canonical.js";
import { SearchReadLimitReached } from "../../src/search/errors.js";
import { openMemory, seedKitchen, type SearchFixture } from "./fixture.js";

const EMPTY_RESULT_HASH = "sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945";
const open: SearchFixture[] = [];

afterEach(() => {
  while (open.length > 0) open.pop()?.close();
});

describe("negative search reads", () => {
  it("records an empty result, ignores a sealed check, then flags a real new match", () => {
    const fixture = openMemory();
    open.push(fixture);
    seedKitchen(fixture);
    const attempt = fixture.attemptFor("T07");
    const query = { query: "webhook" };
    const first = fixture.service.searchNodes(query);
    expect(first.items).toEqual([]);
    const recorded = fixture.service.recordSearchRead({
      attempt,
      query,
      rev: 1,
      items: first.items,
    });
    expect(recorded.ok).toBe(true);
    if (!recorded.ok) return;
    expect(recorded.resultHash).toBe(EMPTY_RESULT_HASH);
    expect(recorded.resultHash).toBe(computeResultSetHash([]));
    expect(fixture.service.verifyRecordedSearchReads(attempt)).toEqual([]);

    const row = fixture.db.prepare(
      "SELECT query AS query, result_hash AS result_hash, json_valid(query) AS valid FROM search_reads WHERE attempt = ?",
    ).get(attempt) as { query: string; result_hash: string; valid: number };
    expect(row.valid).toBe(1);
    expect(row.result_hash).toBe(EMPTY_RESULT_HASH);
    expect(JSON.parse(row.query)).toMatchObject({ query: "webhook" });

    fixture.addNodes([
      {
        id: "H2",
        kind: "check",
        title: "Sealed webhook",
        text: "webhook delivery oracle",
        fields: { feature: "F12", hidden_check: true },
      },
    ]);
    expect(fixture.service.verifyRecordedSearchReads(attempt)).toEqual([]);

    fixture.addNodes([
      {
        id: "R-WH",
        kind: "rule",
        title: "Webhook rule",
        text: "Send the webhook after cutoff",
        fields: { feature: "F12" },
      },
    ]);
    const stale = fixture.service.verifyRecordedSearchReads(attempt);
    expect(stale).toHaveLength(1);
    expect(stale[0]?.attempt).toBe(attempt);
    expect(stale[0]?.recordedResultHash).toBe(EMPTY_RESULT_HASH);
    expect(stale[0]?.currentResultHash).not.toBe(EMPTY_RESULT_HASH);
    expect(fixture.service.searchNodes(query).items.map((item) => item.id)).toContain("R-WH");
    expect(fixture.service.searchNodes(query).items.map((item) => item.id)).not.toContain("H1");
    expect(fixture.service.searchNodes(query).items.map((item) => item.id)).not.toContain("H2");
  });

  it("deduplicates a repeated query hash so it does not consume the 50-read cap", () => {
    const fixture = openMemory();
    open.push(fixture);
    seedKitchen(fixture);
    const attempt = fixture.attemptFor("T03");
    const first = fixture.service.recordSearchRead({
      attempt,
      query: { query: "q-repeat" },
      rev: 2,
      items: [],
    });
    const second = fixture.service.recordSearchRead({
      attempt,
      query: { query: "q-repeat" },
      rev: 2,
      items: [{ id: "T03", version: 1 }],
    });
    expect(first.ok && second.ok && second.deduplicated).toBe(true);
    if (first.ok && second.ok) expect(second.resultHash).toBe(first.resultHash);

    for (let index = 0; index < 49; index += 1) {
      const result = fixture.service.recordSearchRead({
        attempt,
        query: { query: `unique-${index}` },
        rev: 2,
        items: [],
      });
      expect(result.ok).toBe(true);
    }
    const overflow = fixture.service.recordSearchRead({
      attempt,
      query: { query: "overflow-query" },
      rev: 2,
      items: [],
    });
    expect(overflow.ok).toBe(false);
    if (!overflow.ok) {
      expect(overflow.notice).toBeInstanceOf(SearchReadLimitReached);
      expect(overflow.notice.code).toBe("search_read_limit_reached");
      expect(overflow.notice.limit).toBe(50);
      expect(overflow.notice.attempt).toBe(attempt);
    }
    const replay = fixture.service.recordSearchRead({
      attempt,
      query: { query: "q-repeat" },
      rev: 2,
      items: [],
    });
    expect(replay.ok).toBe(true);
    if (replay.ok) expect(replay.deduplicated).toBe(true);
    const count = fixture.db.prepare("SELECT count(*) AS c FROM search_reads WHERE attempt = ?").get(attempt) as {
      c: number;
    };
    expect(count.c).toBe(50);
  });
});
