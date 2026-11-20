import { describe, expect, it } from "vitest";
import { MigrationPreservationVerifier } from "../../src/surfaces/migration-preservation-verifier.js";
import { analyzeMigrationSql } from "../../src/surfaces/destructive-sql.js";
import { generateMigrationPredecessorFixture } from "../../src/surfaces/ports/synthetic-data.js";
import { openTier3Database } from "../../src/surfaces/ports/database.js";
import { verifierContext } from "./support.js";

const columns = [
  { name: "id", type: "integer" as const, nullable: false, primaryKey: true },
  { name: "name", type: "text" as const, nullable: false, maxLength: 32 },
  { name: "note", type: "text" as const, nullable: true, maxLength: 80 },
  { name: "owner_id", type: "integer" as const, nullable: true },
  { name: "created_at", type: "timestamp" as const, nullable: false },
];

const createSql = `
CREATE TABLE dishes (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  note TEXT,
  owner_id INTEGER,
  created_at TEXT NOT NULL
)`;

const copySql = `
CREATE TABLE IF NOT EXISTS dishes_next (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  note TEXT,
  owner_id INTEGER,
  created_at TEXT NOT NULL,
  sku TEXT
);
INSERT INTO dishes_next (id, name, note, owner_id, created_at, sku)
SELECT id, name, note, owner_id, created_at, 'SKU-' || id FROM dishes
WHERE NOT EXISTS (SELECT 1 FROM dishes_next WHERE dishes_next.id = dishes.id);
CREATE INDEX IF NOT EXISTS dishes_next_owner_idx ON dishes_next(owner_id);`;

function baseSpec(upSql: string, extras: Record<string, unknown> = {}) {
  return {
    checkId: "migration.dishes",
    dialect: "sqlite" as const,
    table: "dishes",
    postTable: "dishes_next",
    primaryKey: "id",
    predecessor: { createSql, columns, seed: 7 },
    unchangedColumns: ["name", "note", "owner_id", "created_at"],
    upSql,
    downSql: "DROP TABLE IF EXISTS dishes_next;",
    statementTimeoutMs: 2_000,
    transformations: [
      {
        description: "sku from id",
        sql: "SELECT id, sku FROM dishes_next WHERE id = 1",
        expect: { id: 1, sku: "SKU-1" },
      },
    ],
    readSql: "SELECT id, name, sku FROM dishes_next ORDER BY id",
    expectedIndexes: ["dishes_next_owner_idx"],
    ...extras,
  };
}

describe("MigrationPreservationVerifier", () => {
  it("builds a predecessor fixture with nulls, unicode, max lengths, duplicates, boundary dates, and an orphan", () => {
    const fixture = generateMigrationPredecessorFixture({ columns, seed: 7 });
    expect(fixture.profile).toEqual({
      nulls: true,
      unicode: true,
      maxLengths: true,
      duplicates: true,
      boundaryDates: true,
      orphanLooking: true,
    });
    const again = generateMigrationPredecessorFixture({ columns, seed: 7 });
    expect(again.rows).toEqual(fixture.rows);
    expect(generateMigrationPredecessorFixture({ columns, seed: 8 }).rows).not.toEqual(fixture.rows);
  });

  it("flags DROP COLUMN, DROP TABLE, renames, and destructive type changes", () => {
    expect(analyzeMigrationSql("ALTER TABLE dishes DROP COLUMN note").destructive).toBe(true);
    expect(analyzeMigrationSql("DROP TABLE dishes").destructive).toBe(true);
    expect(analyzeMigrationSql("ALTER TABLE dishes ALTER COLUMN name TYPE integer").destructive).toBe(true);
    expect(analyzeMigrationSql("ALTER TABLE dishes RENAME COLUMN name TO title").requiresExpandThenContract).toBe(true);
  });

  it("passes a clean copy, proves re-run idempotence, and round-trips the down migration", async () => {
    const results = await new MigrationPreservationVerifier().verify(baseSpec(copySql), verifierContext("http://127.0.0.1"));
    expect(results.map((result) => [result.check_id, result.status])).toEqual([
      ["migration.dishes:preservation", "pass"],
      ["migration.dishes:idempotence", "pass"],
      ["migration.dishes:down-migration", "pass"],
    ]);
    expect(results[0]?.receipt.destructive).toBe(false);
    expect(results[0]?.receipt.fixture).toMatchObject({ unicode: true, nulls: true });
  });

  it("runs the same preservation check on the postgres dialect and records statement_timeout", async () => {
    const results = await new MigrationPreservationVerifier().verify(
      baseSpec(copySql, { dialect: "postgres" }),
      verifierContext("http://127.0.0.1"),
    );
    expect(results.every((result) => result.status === "pass")).toBe(true);
    expect(results[0]?.receipt.dialect).toBe("postgres");
    expect(results[0]?.receipt.statements).toEqual([
      "SET statement_timeout = '2000ms'",
      copySql,
    ]);
  });

  it("refuses sqlite-specific SQL on the postgres engine", async () => {
    const session = await openTier3Database("postgres");
    try {
      const outcome = await session.apply("PRAGMA user_version = 1;", 1_000);
      expect(outcome.ok).toBe(false);
      expect(outcome.message).toContain("postgres");
      expect(outcome.statements[0]).toContain("statement_timeout");
    } finally {
      await session.close();
    }
  });

  it("catches a migration that drops a row or corrupts unicode", async () => {
    const dropped = await new MigrationPreservationVerifier().verify(
      baseSpec(`DELETE FROM dishes WHERE id = (SELECT MIN(id) FROM dishes);\n${copySql}`),
      verifierContext("http://127.0.0.1"),
    );
    const corrupted = await new MigrationPreservationVerifier().verify(
      baseSpec(
        copySql.replace(
          "SELECT id, name, note, owner_id, created_at, 'SKU-' || id FROM dishes",
          "SELECT id, REPLACE(name, '🍜', ''), note, owner_id, created_at, 'SKU-' || id FROM dishes",
        ),
      ),
      verifierContext("http://127.0.0.1"),
    );
    expect(dropped.find((result) => result.check_id.endsWith(":preservation"))?.message).toContain("row count");
    expect(corrupted.find((result) => result.check_id.endsWith(":preservation"))?.message).toContain("name");
  });

  it("flags DROP COLUMN as destructive and catches a non-idempotent re-run", async () => {
    const results = await new MigrationPreservationVerifier().verify(
      {
        ...baseSpec("ALTER TABLE dishes DROP COLUMN note;", {
          postTable: "dishes",
          unchangedColumns: ["name", "owner_id", "created_at"],
          downSql: undefined,
          transformations: [
            { description: "name kept", sql: "SELECT name FROM dishes WHERE id = 1", expect: { name: "Soup" } },
          ],
          readSql: "SELECT id, name FROM dishes ORDER BY id",
          expectedIndexes: [],
        }),
      },
      verifierContext("http://127.0.0.1"),
    );
    const preservation = results.find((result) => result.check_id.endsWith(":preservation"));
    const idempotence = results.find((result) => result.check_id.endsWith(":idempotence"));
    expect(preservation?.status).toBe("pass");
    expect(preservation?.receipt.destructive).toBe(true);
    expect(preservation?.receipt.requiresExpandThenContract).toBe(true);
    expect(idempotence?.status).toBe("fail");
  });

  it("aborts a hanging migration at statement_timeout", async () => {
    const results = await new MigrationPreservationVerifier().verify(
      baseSpec("SELECT ef_sleep_ms(5000);", { statementTimeoutMs: 400, downSql: undefined }),
      verifierContext("http://127.0.0.1"),
    );
    const preservation = results.find((result) => result.check_id.endsWith(":preservation"));
    expect(preservation?.status).toBe("fail");
    expect(preservation?.message).toContain("statement_timeout");
    expect(preservation?.receipt.timedOut).toBe(true);
  });
});
