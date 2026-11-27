import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AttachedDatabaseForbiddenError,
  ProjectStateDb,
  ReaderPool,
  UnknownQueryError,
  loadNamedQueries,
  openProjectStateDb,
  splitSearchText,
  type DbHandle,
  type SqliteConnection,
} from "../../src/index.js";

const closers: Array<() => Promise<void> | void> = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

describe("ProjectStateDb unified DbHandle, ef_search_text, and queries", () => {
  it("exposes .writer, .readers, .query(), and identical ef_search_text acronym splitting across writer and ReaderPool", async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-c05-state-"));
    dirs.push(rootDir);
    const db = openProjectStateDb({ projectId: "C05State", rootDir });
    closers.unshift(() => {
      if (!db.isClosed()) db.close();
    });
    closers.unshift(() => db.readers.close());

    const handle: DbHandle = db;
    const writer: SqliteConnection = handle.writer;
    const readers: ReaderPool = handle.readers;
    expect(db).toBeInstanceOf(ProjectStateDb);
    expect(readers).toBeInstanceOf(ReaderPool);
    expect(handle.query("op_lookup")).toContain("operations");
    expect(() => handle.query("missing_named_query")).toThrow(UnknownQueryError);
    expect(loadNamedQueries().get("op_lookup")).toBe(handle.query("op_lookup"));

    const writerXml = writer.get("SELECT ef_search_text(?) AS text", ["XMLHttpRequest"]) as {
      text: string;
    };
    const readerXml = (await readers.query({
      sql: "SELECT ef_search_text(?) AS text",
      params: ["XMLHttpRequest"],
      class: "ui",
      timeoutMs: 200,
    })) as Array<{ text: string }>;
    expect(writerXml.text).toBe(splitSearchText("XMLHttpRequest"));
    expect(writerXml.text).toBe("XMLHttpRequest XML Http Request");
    expect(writerXml.text).toContain("XML Http Request");
    expect(readerXml).toEqual([{ text: writerXml.text }]);

    const writerParsed = writer.get("SELECT ef_search_text(?) AS text", [
      "parseXMLHttpRequest_v2",
    ]) as { text: string };
    const readerParsed = (await readers.query({
      sql: "SELECT ef_search_text(?) AS text",
      params: ["parseXMLHttpRequest_v2"],
      class: "ui",
      timeoutMs: 200,
    })) as Array<{ text: string }>;
    expect(writerParsed.text).toBe(splitSearchText("parseXMLHttpRequest_v2"));
    expect(writerParsed.text).toContain("parse XML Http Request v2");
    expect(readerParsed).toEqual([{ text: writerParsed.text }]);

    writer.transaction(() => {
      writer.run(
        "INSERT INTO change_sets(id, rev, origin, author, created_at) VALUES (:id, :rev, :origin, :author, :createdAt)",
        { id: "CS-1", rev: 1, origin: "planner", author: "c05", createdAt: 10 },
      );
      writer.savepoint(() => {
        const stmt = writer.prepare(
          `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev)
           VALUES (:id, :kind, 1, :hash, :title, '', '{}', :cs, 1, 1)`,
        );
        try {
          stmt.run({
            id: "T01",
            kind: "task",
            hash: "sha256:" + "a".repeat(64),
            title: "parseXMLHttpRequest_v2",
            cs: "CS-1",
          });
        } finally {
          stmt.finalize();
        }
      });
    });

    const ftsQuery = "SELECT n.id AS id FROM kb_words w JOIN nodes n ON n.nid = w.rowid WHERE kb_words MATCH ?";
    const writerMatches = writer.all(ftsQuery, ["XML AND Http AND Request"]);
    const readerMatches = await readers.query({
      sql: ftsQuery,
      params: ["XML AND Http AND Request"],
      class: "ui",
      timeoutMs: 200,
    });
    expect(writerMatches).toEqual([{ id: "T01" }]);
    expect(readerMatches).toEqual([{ id: "T01" }]);

    const queryOnly = await readers.query({
      sql: "PRAGMA query_only",
      class: "ui",
      timeoutMs: 200,
    });
    expect(queryOnly).toEqual([{ query_only: 1 }]);

    expect(() => writer.exec("ATTACH DATABASE ':memory:' AS other")).toThrow(
      AttachedDatabaseForbiddenError,
    );
    expect(() => writer.prepare("ATTACH DATABASE ':memory:' AS other")).toThrow(
      AttachedDatabaseForbiddenError,
    );
    await expect(
      readers.query({
        sql: "ATTACH DATABASE ':memory:' AS other",
        class: "ui",
        timeoutMs: 200,
      }),
    ).rejects.toBeInstanceOf(AttachedDatabaseForbiddenError);
    await expect(
      readers.query({
        sql: "INSERT INTO meta(key, value) VALUES ('bad', '1')",
        class: "ui",
        timeoutMs: 200,
      }),
    ).rejects.toThrow(/readonly|query_only|attempt to write/i);
  });
});
