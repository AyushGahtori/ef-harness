import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { splitSearchText } from "../../src/search/canonical.js";
import { asSqliteConnection } from "../../src/search/connection.js";
import { KnowledgeSearchService } from "../../src/search/service.js";
import { openFile, seedKitchen, type SearchFixture } from "./fixture.js";

const open: SearchFixture[] = [];

afterEach(() => {
  while (open.length > 0) open.pop()?.close();
});

describe("VACUUM rowid stability", () => {
  it("preserves nodes.nid and keeps both FTS indexes accurate", () => {
    const fixture = openFile();
    open.push(fixture);
    seedKitchen(fixture);
    const before = fixture.db.prepare("SELECT id, nid FROM nodes ORDER BY nid").all() as {
      id: string;
      nid: number;
    }[];
    expect(before.length).toBeGreaterThan(0);
    const file = fixture.file;
    if (!file) throw new Error("expected a state.db file");
    fixture.release();

    const vacuumed = new DatabaseSync(file);
    try {
      vacuumed.exec("VACUUM");
      const after = vacuumed.prepare("SELECT id, nid FROM nodes ORDER BY nid").all() as {
        id: string;
        nid: number;
      }[];
      expect(after).toEqual(before);

      const orphanWords = vacuumed.prepare(
        `SELECT w.rowid AS rowid
           FROM kb_words AS w
           LEFT JOIN nodes AS n ON n.nid = w.rowid
          WHERE n.nid IS NULL`,
      ).all();
      const orphanIdent = vacuumed.prepare(
        `SELECT k.rowid AS rowid
           FROM kb_ident AS k
           LEFT JOIN nodes AS n ON n.nid = k.rowid
          WHERE n.nid IS NULL`,
      ).all();
      const missingWords = vacuumed.prepare(
        `SELECT n.id AS id
           FROM nodes AS n
           LEFT JOIN kb_words AS w ON w.rowid = n.nid
          WHERE w.rowid IS NULL`,
      ).all();
      const missingIdent = vacuumed.prepare(
        `SELECT n.id AS id
           FROM nodes AS n
           LEFT JOIN kb_ident AS k ON k.rowid = n.nid
          WHERE k.rowid IS NULL`,
      ).all();
      expect(orphanWords).toEqual([]);
      expect(orphanIdent).toEqual([]);
      expect(missingWords).toEqual([]);
      expect(missingIdent).toEqual([]);

      vacuumed.function("ef_search_text", { deterministic: true }, (value) => splitSearchText(value ?? ""));
      const connection = asSqliteConnection(vacuumed);
      const service = new KnowledgeSearchService({ reader: connection, writer: connection });
      expect(service.searchNodes({ query: "print rows" }).items.map((item) => item.id)).toContain("T03");
      expect(service.searchByIdSubstring("C-01").items.map((item) => item.id)).toContain("C-014");
      expect(service.searchNodes({ query: "close 10" }).items.map((item) => item.id)).toContain("R17");
      expect(fs.existsSync(file)).toBe(true);
    } finally {
      vacuumed.close();
    }
  });
});
