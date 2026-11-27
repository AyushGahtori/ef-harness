import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AttachedDatabaseForbiddenError,
  CodeIndexDb,
  GlobalBrokerDb,
  ReaderPool,
  TelemetryDb,
  UnknownQueryError,
  type DbHandle,
  type ProcessIdentity,
  type SqliteConnection,
} from "../../src/index.js";
import { useTempDirs } from "./lifecycle.js";
import { projectPath } from "./temp-root.js";

const identity: ProcessIdentity = {
  pid: 99,
  processStartTime: 1_700_000_000_000,
  hostname: "c05-host",
};

describe("auxiliary databases unified DbHandle (.writer, .readers, .query)", () => {
  const dirs = useTempDirs();

  it("exposes .writer, .readers (query_only=ON), .query(), and rejects ATTACH across GlobalBrokerDb, TelemetryDb, and CodeIndexDb", async () => {
    const root = dirs.root("aux-handles");
    const globalDb = GlobalBrokerDb.open({ root, identity, now: () => 1_000 });
    dirs.close(() => globalDb.close());
    globalDb.registerProject({
      id: "alpha",
      path: projectPath("Alpha"),
      displayName: "Alpha",
      schemaVersion: 1,
    });

    const telemetryDb = TelemetryDb.open({
      filePath: globalDb.layout.projectTelemetryPath("alpha"),
      now: () => 1_000,
      flushIntervalMs: 60_000,
    });
    dirs.close(() => telemetryDb.close());
    telemetryDb.enqueue({ ts: 1_000, kind: "metric", data: { ok: true } });
    telemetryDb.flush();

    const codeIndexDb = CodeIndexDb.open({
      filePath: path.join(dirs.root("aux-code-index"), "code-index.db"),
    });
    dirs.close(() => codeIndexDb.close());
    codeIndexDb.upsertCommit({ commitSha: "e".repeat(40), builtAt: 1_000, files: 1 });

    const handles: ReadonlyArray<{
      readonly name: string;
      readonly handle: DbHandle;
      readonly selectSql: string;
      readonly expectedRow: Record<string, unknown>;
    }> = [
      {
        name: "GlobalBrokerDb",
        handle: globalDb,
        selectSql: "SELECT id FROM projects WHERE id = :id",
        expectedRow: { id: "alpha" },
      },
      {
        name: "TelemetryDb",
        handle: telemetryDb,
        selectSql: "SELECT kind FROM telemetry WHERE kind = ?",
        expectedRow: { kind: "metric" },
      },
      {
        name: "CodeIndexDb",
        handle: codeIndexDb,
        selectSql: "SELECT commit_sha FROM indexed_commits WHERE commit_sha = :sha",
        expectedRow: { commit_sha: "e".repeat(40) },
      },
    ];

    for (const entry of handles) {
      const writer: SqliteConnection = entry.handle.writer;
      const readers: ReaderPool = entry.handle.readers;
      expect(readers).toBeInstanceOf(ReaderPool);
      expect(entry.handle.query("global_cas_gc_candidates")).toContain("cas_blobs");
      expect(() => entry.handle.query("unknown_named_query")).toThrow(UnknownQueryError);

      expect(writer.pragma("journal_mode")).toEqual({ journal_mode: "wal" });
      expect(writer.pragma("foreign_keys")).toEqual({ foreign_keys: 1 });
      expect(writer.pragma("busy_timeout")).toEqual({ timeout: 5000 });

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

      const queryOnly = await readers.query({
        sql: "PRAGMA query_only",
        class: "ui",
        timeoutMs: 200,
      });
      expect(queryOnly).toEqual([{ query_only: 1 }]);

      if (entry.name === "GlobalBrokerDb") {
        const rows = await readers.query({
          sql: entry.selectSql,
          params: { id: "alpha" },
          class: "ui",
          timeoutMs: 200,
        });
        expect(rows).toEqual([entry.expectedRow]);
      } else if (entry.name === "TelemetryDb") {
        const rows = await readers.query({
          sql: entry.selectSql,
          params: ["metric"],
          class: "ui",
          timeoutMs: 200,
        });
        expect(rows).toEqual([entry.expectedRow]);
      } else {
        const rows = await readers.query({
          sql: entry.selectSql,
          params: { sha: "e".repeat(40) },
          class: "ui",
          timeoutMs: 200,
        });
        expect(rows).toEqual([entry.expectedRow]);
      }

      await readers.close();
    }

    globalDb.writer.transaction(() => {
      const stmt = globalDb.writer.prepare(
        "INSERT INTO settings(key, value) VALUES (:key, :value)",
      );
      try {
        stmt.run({ key: "c05.named", value: "true" });
      } finally {
        stmt.finalize();
      }
      globalDb.writer.savepoint(() => {
        const pos = globalDb.writer.prepare("INSERT INTO settings(key, value) VALUES (?, ?)");
        try {
          pos.run(["c05.pos", "123"]);
        } finally {
          pos.finalize();
        }
      });
    });
    expect(globalDb.getSetting("c05.named")).toBe(true);
    expect(globalDb.getSetting("c05.pos")).toBe(123);
  });
});
