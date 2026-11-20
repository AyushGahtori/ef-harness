import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  SyntheticDataGenerator,
  loadDatasetSqlite,
  measureText,
} from "../../src/synthetic-data/index.js";
import { categorySchema, cycleSchema, demoSchema, migrationsFor, performanceSchema, recipe } from "./fixture.js";

const generator = new SyntheticDataGenerator();

describe("sqlite bulk load", () => {
  it("keeps foreign keys enabled and preserves boundaries", () => {
    const dataset = generator.generateDataset(demoSchema, recipe());
    const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
    for (const migration of migrationsFor(demoSchema)) db.exec(migration);
    loadDatasetSqlite(db, dataset);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_keys").get()?.foreign_keys).toBe(1);
    const names = db.prepare("SELECT name FROM users").all().map((row) => String(row.name));
    expect(names.some((name) => name.includes("🍜") && measureText(name, "code_points") <= 32)).toBe(true);
    expect(() => {
      db.prepare("INSERT INTO orders (id, user_id, quantity, dish, happened_at) VALUES (999999, 999999, 1, 'Ramen', '2024-01-01T00:00:00.000Z')").run();
    }).toThrow();
    db.close();
  });

  it("loads self-references and mutual cycles with foreign keys on", () => {
    for (const schema of [categorySchema, cycleSchema]) {
      const dataset = generator.generateDataset(schema, recipe());
      const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
      for (const migration of migrationsFor(schema)) db.exec(migration);
      loadDatasetSqlite(db, dataset);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      db.close();
    }
  });

  it("generates and bulk-loads 10000 performance rows in under 3 seconds", () => {
    const started = performance.now();
    const dataset = generator.generateDataset(performanceSchema, {
      seed: 42,
      profile: "performance",
      locale: "en",
    });
    const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
    for (const migration of migrationsFor(performanceSchema)) db.exec(migration);
    loadDatasetSqlite(db, dataset);
    const elapsed = performance.now() - started;
    const orders = db.prepare("SELECT count(*) AS c FROM orders").get()?.c;
    const duplicateEmails = db
      .prepare("SELECT count(*) AS c FROM (SELECT email FROM users GROUP BY email HAVING count(*) > 1)")
      .get()?.c;
    expect(orders).toBeGreaterThanOrEqual(10000);
    expect(duplicateEmails).toBe(0);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(elapsed).toBeLessThan(3000);
    const counts = db.prepare("SELECT user_id, count(*) AS c FROM orders WHERE user_id IS NOT NULL GROUP BY user_id").all();
    const sizes = counts.map((row) => Number(row.c));
    expect(Math.max(...sizes)).toBeGreaterThan(median(sizes) * 2);
    db.close();
  });
});

function median(values: number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)] ?? 0;
}
