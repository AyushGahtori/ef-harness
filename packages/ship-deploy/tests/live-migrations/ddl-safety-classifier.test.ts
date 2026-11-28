import { describe, expect, it } from "vitest";
import {
  DdlSafetyClassifier,
  EXPAND_SPLIT_GUIDANCE,
  LOCK_HAZARD_GUIDANCE,
} from "../../src/live-migrations/index.js";

describe("DdlSafetyClassifier", () => {
  const postgres = new DdlSafetyClassifier("postgres");
  const sqlite = new DdlSafetyClassifier("sqlite");

  it("separates additive, lock-hazard, and destructive statements", () => {
    const sql = `
      CREATE TABLE dietary_tags (id INTEGER PRIMARY KEY, tag TEXT);
      ALTER TABLE orders ADD COLUMN price_cents INTEGER NULL;
      ALTER TABLE orders ADD COLUMN note TEXT NOT NULL DEFAULT 'none';
      CREATE INDEX CONCURRENTLY orders_price ON orders (price_cents);
      ALTER TYPE order_status ADD VALUE 'refunded';
      CREATE VIEW open_orders AS SELECT id FROM orders;
      CREATE TRIGGER orders_touch AFTER UPDATE ON orders BEGIN SELECT 1; END;
      CREATE INDEX orders_legacy ON orders (legacy_price);
      ALTER TABLE orders ADD COLUMN tight INTEGER NOT NULL;
      ALTER TABLE orders ALTER COLUMN legacy_price TYPE bigint;
      ALTER TABLE orders ALTER COLUMN price_cents SET NOT NULL;
      ALTER TABLE orders DROP COLUMN legacy_price;
      DROP TABLE archived_orders;
      ALTER TABLE orders RENAME COLUMN note TO public_note;
      DELETE FROM orders WHERE id < 0;
      TRUNCATE TABLE orders;
    `;
    const result = postgres.classify(sql);
    const bySafety = (safety: string) => result.statements.filter((statement) => statement.safety === safety);

    expect(bySafety("SAFE_ADDITIVE").map((statement) => statement.sql)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("CREATE TABLE dietary_tags"),
        expect.stringContaining("ADD COLUMN price_cents INTEGER NULL"),
        expect.stringContaining("DEFAULT 'none'"),
        expect.stringContaining("CREATE INDEX CONCURRENTLY"),
        expect.stringContaining("ADD VALUE"),
        expect.stringContaining("CREATE VIEW"),
        expect.stringContaining("CREATE TRIGGER"),
      ]),
    );
    expect(result.statements.filter((statement) => statement.sql.includes("CREATE TRIGGER"))).toHaveLength(1);
    expect(bySafety("LOCK_HAZARD").length).toBeGreaterThanOrEqual(4);
    const index = result.lockHazards.find((statement) => statement.sql.includes("orders_legacy"));
    expect(index?.rewrittenSql).toContain("INDEX CONCURRENTLY");
    expect(index?.guidance).toContain("lock_timeout = '2s'");
    const notNull = result.lockHazards.find((statement) => statement.sql.includes("tight"));
    expect(notNull?.guidance).toContain("NOT VALID");
    expect(notNull?.rewriteSteps?.some((step) => step.includes("NOT VALID"))).toBe(true);
    expect(result.lockHazards.some((statement) => /TYPE bigint/i.test(statement.sql))).toBe(true);
    expect(result.lockHazards.some((statement) => /SET NOT NULL/i.test(statement.sql))).toBe(true);
    expect(result.contractSql.some((statement) => statement.includes("DROP COLUMN legacy_price"))).toBe(true);
    expect(result.contractSql.some((statement) => statement.startsWith("DROP TABLE"))).toBe(true);
    expect(result.contractSql.some((statement) => /RENAME COLUMN/i.test(statement))).toBe(true);
    expect(result.contractSql.some((statement) => statement.startsWith("DELETE FROM"))).toBe(true);
    expect(result.contractSql.some((statement) => statement.startsWith("TRUNCATE"))).toBe(true);
    expect(LOCK_HAZARD_GUIDANCE).toContain("statement_timeout");
  });

  it("treats a plain SQLite CREATE INDEX as additive", () => {
    const result = sqlite.classify("CREATE INDEX orders_legacy ON orders (legacy_price);");
    expect(result.statements[0]?.safety).toBe("SAFE_ADDITIVE");
  });

  it("hard-rejects destructive DDL inside Phase 3 Expand", () => {
    const sql = `
      ALTER TABLE orders ADD COLUMN price_cents INTEGER;
      ALTER TABLE orders DROP COLUMN legacy_price;
    `;
    const result = postgres.classify(sql);
    expect(result.mixedDestructiveIntoExpand).toBe(true);
    expect(result.splitGuidance).toBe(EXPAND_SPLIT_GUIDANCE);
    expect(result.expandSql).toHaveLength(1);
    expect(result.contractSql).toHaveLength(1);
    expect(result.contractObjects).toEqual([{ table: "orders", column: "legacy_price" }]);
    expect(() => postgres.assertExpandOnly(sql)).toThrow(/hard-rejects mixing DESTRUCTIVE_CONTRACT into Phase 3/);
  });
});
