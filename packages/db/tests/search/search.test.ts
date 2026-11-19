import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  canonicalizeJson,
  computeResultSetHash,
  computeSearchQueryHash,
  splitSearchText,
} from "../../src/search/canonical.js";
import { asSqliteConnection } from "../../src/search/connection.js";
import { KnowledgeSearchService } from "../../src/search/service.js";
import { sanitizeFtsQuery } from "../../src/search/sanitize.js";
import type { SqliteConnection } from "../../src/search/types.js";
import { openFile, openMemory, seedKitchen, type SearchFixture } from "./fixture.js";

const open: SearchFixture[] = [];

afterEach(() => {
  while (open.length > 0) open.pop()?.close();
});

function memory(): SearchFixture {
  const fixture = openMemory();
  open.push(fixture);
  return fixture;
}

describe("dual FTS5 knowledge search", () => {
  it("matches the Task 007 search-text and empty-result hash pipeline", () => {
    expect(splitSearchText("Map totals with toPrintRows")).toBe(
      "Map totals with toPrintRows Map totals with to Print Rows",
    );
    expect(splitSearchText("XMLHttpRequest")).toContain("XML Http Request");
    expect(splitSearchText("cutoff_rule")).toContain("cutoff rule");
    expect(splitSearchText("")).toBe("");
    const payload = {
      filters: {
        basis: [] as string[],
        excludeHiddenChecks: true,
        feature: "F12",
        kinds: ["rule"],
        limit: 20,
        status: "active",
        tags: [] as string[],
      },
      query: "print rows",
    };
    expect(canonicalizeJson(payload)).toBe(
      '{"filters":{"basis":[],"excludeHiddenChecks":true,"feature":"F12","kinds":["rule"],"limit":20,"status":"active","tags":[]},"query":"print rows"}',
    );
    expect(computeSearchQueryHash(payload)).toBe(
      "sha256:97695a6ddd6d65bfd6e8efa5f8342a9109951271d79fa7349d44959abd8f3a57",
    );
    const empty = computeResultSetHash([]);
    expect(empty).toBe("sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945");
    expect(empty).not.toBe(computeResultSetHash([{ id: "T03", version: 1 }]));
    expect(computeResultSetHash([{ id: "B", version: 1 }, { id: "A", version: 2 }])).toBe(
      computeResultSetHash([{ id: "A", version: 2 }, { id: "B", version: 1 }]),
    );
  });

  it("finds camelCase words, identifier substrings, and snake_case parts", () => {
    const fixture = memory();
    seedKitchen(fixture);
    const words = fixture.service.searchNodes({ query: "print rows" });
    expect(words.items.map((item) => item.id)).toContain("T03");
    expect(words.items.every((item) => item.snippet.length <= 180)).toBe(true);
    expect(words.items.find((item) => item.id === "T03")?.snippet).toMatch(/«print»/i);

    const ident = fixture.service.searchNodes({ query: "C-01" });
    expect(ident.items.map((item) => item.id)).toContain("C-014");
    const bySubstring = fixture.service.searchByIdSubstring("C-01");
    expect(bySubstring.items.map((item) => item.id)).toContain("C-014");
    expect(fixture.service.searchByIdSubstring("C").items.map((item) => item.id)).toContain("C-014");
    expect(fixture.service.searchNodes({ query: "T07" }).items.map((item) => item.id)).toContain("T07");
    expect(fixture.service.searchNodes({ query: "SI-212" }).items.map((item) => item.id)).toContain("SI-212");

    const snake = fixture.service.searchNodes({ query: "cutoff rule" });
    expect(snake.items.map((item) => item.id)).toEqual(expect.arrayContaining(["R17", "X1"]));
  });

  it("drops removed text immediately and hits the updated text", () => {
    const fixture = memory();
    seedKitchen(fixture);
    expect(fixture.service.searchNodes({ query: "45" }).items.map((item) => item.id)).toContain("R17");
    fixture.updateText("R17", "Orders close at 10:30");
    expect(fixture.service.searchNodes({ query: "45" }).items.map((item) => item.id)).not.toContain("R17");
    expect(fixture.service.searchNodes({ query: "30" }).items.map((item) => item.id)).toContain("R17");
    expect(fixture.service.searchNodes({ query: "close 10" }).items.map((item) => item.id)).toContain("R17");
  });

  it("sanitizes FTS metacharacters, keywords, and one-character queries", () => {
    expect(sanitizeFtsQuery('"C-014" OR (foo*')).toBe('"C" AND "014" AND "OR" AND "foo"');
    expect(sanitizeFtsQuery("foo:bar")).toBe('"foo" AND "bar"');
    expect(sanitizeFtsQuery('""')).toBe("");
    expect(sanitizeFtsQuery("a")).toBe('"a"*');
    expect(sanitizeFtsQuery("ab")).toBe('"ab"*');
    expect(sanitizeFtsQuery("OR NOT NEAR")).toBe('"OR" AND "NOT" AND "NEAR"');
    const fixture = memory();
    seedKitchen(fixture);
    for (const query of ['"C-014" OR (foo*', "foo:bar", '""', "a", "OR NOT NEAR", "((((", "*:*"]) {
      expect(() => fixture.service.searchNodes({ query })).not.toThrow();
    }
    expect(fixture.service.searchNodes({ query: '"C-014" OR (foo*' }).items.map((item) => item.id)).toContain(
      "C-014",
    );
  });

  it("applies kind, feature, status, basis, and tag filters and hides sealed checks", () => {
    const fixture = memory();
    seedKitchen(fixture);
    expect(fixture.service.searchNodes({ query: "print", kinds: ["task"] }).items.every((item) => item.kind === "task")).toBe(
      true,
    );
    expect(fixture.service.searchNodes({ query: "feature", feature: "F99" }).items.map((item) => item.id)).toEqual([
      "F99",
    ]);
    expect(fixture.service.searchNodes({ query: "cutoff", basis: ["derived"] }).items.map((item) => item.id)).toContain(
      "X1",
    );
    expect(fixture.service.searchNodes({ query: "cutoff", basis: ["derived"] }).items.map((item) => item.id)).not.toContain(
      "R17",
    );
    expect(fixture.service.searchNodes({ query: "cutoff", tags: ["cutoff"] }).items.map((item) => item.id)).toEqual([
      "R17",
    ]);
    expect(fixture.service.searchNodes({ query: "webhook" }).items.map((item) => item.id)).not.toContain("H1");

    fixture.retire("R17");
    expect(fixture.service.searchNodes({ query: "cutoff rule" }).items.map((item) => item.id)).not.toContain("R17");
    expect(
      fixture.service.searchNodes({ query: "cutoff rule", status: "retired" }).items.map((item) => item.id),
    ).toContain("R17");
  });

  it("breaks equal BM25 scores by node id and caps snippets", () => {
    const fixture = memory();
    const shared = "alpha beta shared phrase";
    fixture.addNodes([
      { id: "B-tie", kind: "rule", title: "Shared phrase", text: shared, fields: { feature: "F12" } },
      { id: "A-tie", kind: "rule", title: "Shared phrase", text: shared, fields: { feature: "F12" } },
      {
        id: "LONG",
        kind: "rule",
        title: "print overflow",
        text: `print ${"word ".repeat(2000)}`,
        fields: { feature: "F12" },
      },
    ]);
    const tied = fixture.service.searchNodes({ query: "shared phrase" });
    expect(tied.items.map((item) => item.id)).toEqual(["A-tie", "B-tie"]);
    expect(tied.items[0]?.score).toBe(tied.items[1]?.score);
    const snippet = fixture.service.searchNodes({ query: "print overflow" }).items.find((item) => item.id === "LONG");
    expect(snippet?.snippet.length).toBeLessThanOrEqual(180);
    expect(snippet?.snippet).toMatch(/«print»/i);
    expect(JSON.stringify(snippet)).not.toContain("word word word word word");
  });

  it("keeps ranked search on the read-only connection and within 500 rows", () => {
    const fixture = openFile();
    open.push(fixture);
    seedKitchen(fixture);
    const seen: string[] = [];
    const reader = fixture.connection;
    const writer: SqliteConnection = {
      exec(sql) {
        seen.push(sql);
        reader.exec(sql);
      },
      prepare(sql) {
        seen.push(sql);
        return reader.prepare(sql);
      },
    };
    const guarded: SqliteConnection = {
      exec(sql) {
        throw new Error(`read path exec ${sql}`);
      },
      prepare(sql) {
        if (!/^\s*select\b/i.test(sql)) throw new Error(`read path prepare ${sql}`);
        if (/\boffset\b/i.test(sql)) throw new Error("OFFSET is forbidden");
        seen.push(`read:${sql}`);
        return reader.prepare(sql);
      },
    };
    const service = new KnowledgeSearchService({ reader: guarded, writer });
    const page = service.searchNodes({ query: "print rows", limit: 99999 });
    expect(page.items.length).toBeLessThanOrEqual(500);
    expect(page.items.map((item) => item.id)).toContain("T03");
    expect(seen.some((sql) => sql.startsWith("read:") && sql.includes("bm25(kb_words, 2.0, 1.0)"))).toBe(true);
    expect(seen.some((sql) => sql.startsWith("read:") && sql.includes("LIKE"))).toBe(false);
    expect(service.searchNodes({ query: "C-01" }).items.map((item) => item.id)).toContain("C-014");
    expect(seen.some((sql) => sql.includes("LIKE") && sql.includes("kb_ident"))).toBe(true);
    expect(seen.some((sql) => /\boffset\b/i.test(sql))).toBe(false);
    expect(seen.some((sql) => !sql.startsWith("read:"))).toBe(false);

    const file = fixture.file;
    if (!file) throw new Error("expected a file database");
    const readerDb = new DatabaseSync(file, { readOnly: true });
    readerDb.exec("PRAGMA query_only = ON");
    const readService = new KnowledgeSearchService({
      reader: asSqliteConnection(readerDb),
      writer,
    });
    expect(readService.searchNodes({ query: "print rows" }).items.map((item) => item.id)).toContain("T03");
    expect(readService.listNodesPaginated({ limit: 10 }).items.length).toBeGreaterThan(0);
    expect(() => readerDb.exec("CREATE TABLE blocked(id INTEGER)")).toThrow();
    readerDb.close();
  });

  it("rebuilds contentless words and optimizes both indexes", () => {
    const fixture = memory();
    seedKitchen(fixture);
    fixture.db.exec("DELETE FROM kb_words");
    expect(fixture.service.searchNodes({ query: "print rows" }).items.map((item) => item.id)).not.toContain("T03");
    fixture.service.rebuildSearchIndexes();
    expect(fixture.service.searchNodes({ query: "print rows" }).items.map((item) => item.id)).toContain("T03");
    expect(fixture.service.searchByIdSubstring("C-01").items.map((item) => item.id)).toContain("C-014");
    fixture.service.optimizeSearchIndexes();
    expect(fixture.service.searchNodes({ query: "cutoff rule" }).items.map((item) => item.id)).toContain("X1");
  });

  it("stops a ranked page once the token budget is spent", () => {
    const fixture = openMemory({ tokenBudget: 40 });
    open.push(fixture);
    fixture.addNodes(
      Array.from({ length: 8 }, (_, index) => ({
        id: `B${index}`,
        kind: "rule",
        title: `budgettoken ${"n".repeat(80)} ${index}`,
        fields: { feature: "F12" },
      })),
    );
    const page = fixture.service.searchNodes({ query: "budgettoken", limit: 8 });
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.length).toBeLessThan(8);
    expect(page.hasMore).toBe(true);
    const tokens = page.items.reduce(
      (sum, item) => sum + Math.max(1, Math.ceil(`${item.title}\n${item.snippet}`.length / 4)),
      0,
    );
    expect(tokens).toBeLessThanOrEqual(40 + Math.ceil((page.items[0]?.title.length ?? 0) / 4));
  });
});
