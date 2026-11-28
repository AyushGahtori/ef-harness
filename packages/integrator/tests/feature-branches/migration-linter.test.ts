import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  LocalSkeletonLock,
  MigrationConflictLinter,
  MigrationIntentAndConflictLinter,
  MigrationRehearsalChecker,
  createTemplateDatabase,
  formatUtcTimestamp,
} from "../../src/feature-branches/index.js";
import type { MigrationFile } from "../../src/feature-branches/index.js";
import { createHarness } from "./fixture.js";

const at = new Date(Date.UTC(2026, 10, 19, 1, 15, 0));
const harnesses: { close(): void }[] = [];

afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.close();
});

function linter(locked: ConstructorParameters<typeof LocalSkeletonLock>[0] = [], baseline: readonly string[] = []) {
  return new MigrationIntentAndConflictLinter(new LocalSkeletonLock(locked), baseline);
}

function named(
  engine: MigrationIntentAndConflictLinter,
  input: {
    readonly featureId: string;
    readonly slug: string;
    readonly sql: string;
    readonly at?: Date;
    readonly dependsOn?: readonly string[];
    readonly ccrId?: string | null;
    readonly tool?: MigrationFile["tool"];
    readonly sequence?: number;
  },
): MigrationFile {
  return engine.nameMigration({
    featureId: input.featureId,
    slug: input.slug,
    sql: input.sql,
    at: input.at ?? at,
    ...(input.dependsOn ? { dependsOn: input.dependsOn } : {}),
    ...(input.ccrId !== undefined ? { ccrId: input.ccrId } : {}),
    ...(input.tool ? { tool: input.tool } : {}),
    ...(input.sequence !== undefined ? { sequence: input.sequence } : {}),
  });
}

describe("timestamp+hash migration names", () => {
  it("uses UTC timestamp, a 6-character content hash, and the slug", () => {
    const file = named(linter(), {
      featureId: "F-Menu",
      slug: "Add Menu Tags",
      sql: "CREATE TABLE dietary_tags (id TEXT PRIMARY KEY);",
    });
    expect(formatUtcTimestamp(at)).toBe("20261119011500");
    expect(file.timestamp).toBe("20261119011500");
    expect(file.hash).toMatch(/^[0-9a-f]{6}$/);
    expect(file.slug).toBe("add_menu_tags");
    expect(file.path).toBe(`migrations/${file.timestamp}_${file.hash}_${file.slug}.sql`);
    expect(file.tool).toBe("timestamp-hash");
  });

  it("gives two features that migrate in the same second distinct sortable names", () => {
    const engine = linter();
    const files = Array.from({ length: 24 }, (_, index) =>
      named(engine, {
        featureId: `F-${index}`,
        slug: "add_menu_tags",
        sql: "CREATE TABLE dietary_tags (id TEXT PRIMARY KEY);",
        at,
      }),
    );
    const paths = files.map((file) => file.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(files.every((file) => file.timestamp === "20261119011500")).toBe(true);
    const ordered = engine.orderForApply(files);
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      expect(previous && current).toBeTruthy();
      if (!previous || !current) continue;
      const order =
        previous.timestamp < current.timestamp ||
        (previous.timestamp === current.timestamp && previous.hash <= current.hash);
      expect(order).toBe(true);
    }
  });

  it("salts the hash when a caller already reserved the natural filename", () => {
    const engine = linter();
    const first = named(engine, {
      featureId: "F-Menu",
      slug: "add_menu_tags",
      sql: "CREATE TABLE dietary_tags (id TEXT PRIMARY KEY);",
    });
    const second = engine.nameMigration({
      featureId: "F-Menu",
      slug: "add_menu_tags",
      sql: "CREATE TABLE dietary_tags (id TEXT PRIMARY KEY);",
      at,
      existingNames: [first.path],
    });
    expect(second.path).not.toBe(first.path);
    expect(second.hash).not.toBe(first.hash);
    expect(second.timestamp).toBe(first.timestamp);
  });

  it("rejects bare sequential filenames while more than one feature is open", () => {
    const engine = linter();
    const sequential: MigrationFile = {
      ...named(engine, {
        featureId: "F-Menu",
        slug: "add_tags",
        sql: "CREATE TABLE dietary_tags (id TEXT PRIMARY KEY);",
      }),
      path: "migrations/0004_add_tags.sql",
      id: "F-Menu:migrations/0004_add_tags.sql",
    };
    const parallel = linter().lint([sequential], 2);
    const single = linter().lint([sequential], 1);
    expect(parallel.findings.some((finding) => finding.code === "sequential_filename")).toBe(true);
    expect(single.findings.some((finding) => finding.code === "sequential_filename")).toBe(false);
  });
});

describe("cross-branch DDL conflict lint", () => {
  it("flags a duplicate table, index, and enum", () => {
    const engine = linter();
    const menu = named(engine, {
      featureId: "F-Menu",
      slug: "add_menu_tags",
      sql: [
        "CREATE TABLE dietary_tags (id TEXT PRIMARY KEY);",
        "CREATE UNIQUE INDEX dietary_tags_id ON dietary_tags (id);",
        "CREATE TYPE meal_slot AS ENUM ('breakfast', 'lunch');",
      ].join("\n"),
    });
    const orders = named(engine, {
      featureId: "F-Orders",
      slug: "add_menu_tags_again",
      sql: [
        "CREATE TABLE dietary_tags (id TEXT PRIMARY KEY);",
        "CREATE UNIQUE INDEX dietary_tags_id ON dietary_tags (id);",
        "CREATE TYPE meal_slot AS ENUM ('dinner');",
      ].join("\n"),
      at: new Date(at.getTime() + 1000),
    });
    const codes = engine.lint([menu, orders], 2).findings.filter((finding) => finding.code === "duplicate_object");
    const objects = codes.map((finding) => finding.objectName).sort();
    expect(objects).toEqual(["enum:meal_slot", "index:dietary_tags_id", "table:dietary_tags"]);
  });

  it("flags a drop against an index on the same column", () => {
    const engine = linter();
    const drop = named(engine, {
      featureId: "F-C",
      slug: "drop_display_name",
      sql: "ALTER TABLE users DROP COLUMN display_name;",
    });
    const index = named(engine, {
      featureId: "F-D",
      slug: "index_display_name",
      sql: "CREATE INDEX users_display_name ON users (display_name);",
      at: new Date(at.getTime() + 1000),
    });
    const finding = engine.lint([drop, index], 2).findings.find((item) => item.code === "incompatible_column");
    expect(finding?.objectName).toBe("users.display_name");
    expect(finding?.featureIds).toEqual(["F-C", "F-D"]);
  });

  it("re-stamps an earlier foreign key after the table that creates its target", () => {
    const engine = linter();
    const orders = named(engine, {
      featureId: "F-Orders",
      slug: "orders_fk",
      sql: [
        "CREATE TABLE orders (id TEXT PRIMARY KEY, tag_id TEXT);",
        "ALTER TABLE orders ADD CONSTRAINT orders_tag_fk FOREIGN KEY (tag_id) REFERENCES dietary_tags(id);",
      ].join("\n"),
    });
    const menu = named(engine, {
      featureId: "F-Menu",
      slug: "add_menu_tags",
      sql: "CREATE TABLE dietary_tags (id TEXT PRIMARY KEY);",
      at: new Date(at.getTime() + 5000),
    });
    const report = engine.lint([orders, menu], 2);
    expect(report.findings.some((finding) => finding.code === "fk_order" && finding.objectName === "dietary_tags")).toBe(
      true,
    );
    const restamped = report.restamped.find((file) => file.featureId === "F-Orders");
    expect(restamped?.timestamp).toBe("20261119011506");
    expect(restamped?.timestamp > menu.timestamp).toBe(true);
    const positions = report.ordered.map((file) => file.featureId);
    expect(positions.indexOf("F-Menu")).toBeLessThan(positions.indexOf("F-Orders"));
  });

  it("accepts an explicit depends_on instead of restamping", () => {
    const engine = linter();
    const orders = named(engine, {
      featureId: "F-Orders",
      slug: "orders_fk",
      sql: "ALTER TABLE orders ADD CONSTRAINT orders_tag_fk FOREIGN KEY (tag_id) REFERENCES dietary_tags(id);",
      dependsOn: ["dietary_tags"],
    });
    const menu = named(engine, {
      featureId: "F-Menu",
      slug: "add_menu_tags",
      sql: "CREATE TABLE dietary_tags (id TEXT PRIMARY KEY);",
      at: new Date(at.getTime() + 5000),
    });
    const report = engine.lint([orders, menu], 2);
    expect(report.findings.some((finding) => finding.code === "fk_order")).toBe(false);
    expect(report.restamped).toEqual([]);
    expect(report.ordered.map((file) => file.featureId)).toEqual(["F-Menu", "F-Orders"]);
    expect(orders.sql.startsWith("-- depends_on: dietary_tags")).toBe(true);
  });

  it("does not treat a template table as a missing foreign-key target", () => {
    const engine = linter([], ["users"]);
    const orders = named(engine, {
      featureId: "F-Orders",
      slug: "orders_user",
      sql: "ALTER TABLE orders ADD CONSTRAINT orders_user_fk FOREIGN KEY (user_id) REFERENCES users(id);",
    });
    expect(engine.lint([orders], 1).findings.some((finding) => finding.code === "fk_order")).toBe(false);
  });

  it("blocks destructive DDL on a locked skeleton column unless a CCR id is present", () => {
    const locked = new LocalSkeletonLock([{ kind: "column", name: "display_name", table: "users" }]);
    const engine = new MigrationIntentAndConflictLinter(locked);
    const sneak = named(engine, {
      featureId: "F-C",
      slug: "drop_display_name",
      sql: "ALTER TABLE users DROP COLUMN display_name;",
    });
    const approved = named(engine, {
      featureId: "F-C",
      slug: "drop_display_name",
      sql: "ALTER TABLE users DROP COLUMN display_name;",
      ccrId: "CCR-7",
    });
    expect(engine.lint([sneak], 1).findings.some((finding) => finding.code === "destructive_skeleton")).toBe(true);
    expect(engine.lint([approved], 1).findings.some((finding) => finding.code === "destructive_skeleton")).toBe(false);
    expect(approved.ccrId).toBe("CCR-7");
  });
});

describe("legacy migration tools", () => {
  it("adapts Prisma filenames and serializes colliding Drizzle sequence numbers", () => {
    const engine = linter();
    expect(engine.detectTool(["prisma/migrations/20261119011500_init/migration.sql"])).toBe("prisma");
    expect(engine.detectTool(["drizzle/0001_init.sql"])).toBe("drizzle");
    const prisma = named(engine, {
      featureId: "F-Menu",
      slug: "add_menu_tags",
      sql: "CREATE TABLE dietary_tags (id TEXT PRIMARY KEY);",
      tool: "prisma",
    });
    expect(prisma.path).toBe(`prisma/migrations/${prisma.timestamp}_${prisma.hash}_add_menu_tags/migration.sql`);
    const left = named(engine, {
      featureId: "F-Email",
      slug: "email_log",
      sql: "CREATE TABLE email_log (id TEXT PRIMARY KEY);",
      tool: "drizzle",
      sequence: 1,
    });
    const right = named(engine, {
      featureId: "F-Menu",
      slug: "dietary_tags",
      sql: "CREATE TABLE dietary_tags (id TEXT PRIMARY KEY);",
      tool: "drizzle",
      sequence: 1,
    });
    const report = engine.lint([left, right], 2);
    expect(report.findings.some((finding) => finding.code === "sequence_collision")).toBe(true);
    expect(report.sequencePlan).toEqual([
      {
        featureId: "F-Menu",
        migrationId: right.id,
        fromSequence: 1,
        toSequence: 2,
        fileName: "drizzle/0002_dietary_tags.sql",
      },
    ]);
  });
});

describe("combined migration rehearsal", { timeout: 30_000 }, () => {
  it("applies restamped additive migrations on a clone of the template database", () => {
    const harness = createHarness();
    harnesses.push(harness);
    const template = path.join(harness.root, "template.sqlite");
    createTemplateDatabase(template, "CREATE TABLE users (id TEXT PRIMARY KEY, display_name TEXT);");
    const engine = linter([], ["users"]);
    const orders = named(engine, {
      featureId: "F-Orders",
      slug: "orders_fk",
      sql: "CREATE TABLE orders (id TEXT PRIMARY KEY, tag_id TEXT REFERENCES dietary_tags(id));",
    });
    const menu = named(engine, {
      featureId: "F-Menu",
      slug: "add_menu_tags",
      sql: "CREATE TABLE dietary_tags (id TEXT PRIMARY KEY);",
      at: new Date(at.getTime() + 5000),
    });
    const email = named(engine, {
      featureId: "F-Email",
      slug: "email_log",
      sql: "CREATE TABLE email_log (id TEXT PRIMARY KEY);",
      at: new Date(at.getTime() + 2000),
    });
    const drop = named(engine, {
      featureId: "F-Email",
      slug: "drop_display_name",
      sql: "ALTER TABLE users DROP COLUMN display_name;",
      at: new Date(at.getTime() + 3000),
    });
    const report = engine.lint([orders, menu, email, drop], 3);
    const checker = new MigrationRehearsalChecker();
    const failed = checker.rehearse({
      templatePath: template,
      migrations: [orders, menu],
      destPath: path.join(harness.root, "wrong-order.sqlite"),
    });
    expect(failed.ok).toBe(false);
    expect(failed.error).toContain("dietary_tags");
    const applied = checker.rehearse({
      templatePath: template,
      migrations: report.ordered,
      destPath: path.join(harness.root, "clone.sqlite"),
    });
    expect(applied.ok).toBe(true);
    expect(applied.error).toBeNull();
    expect(applied.withheld).toEqual([drop.id]);
    const db = new DatabaseSync(applied.clonePath);
    try {
      const names = db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
        .all()
        .map((row) => (row as { name: string }).name);
      expect(names).toEqual(["dietary_tags", "email_log", "orders", "users"]);
      const columns = db.prepare(`PRAGMA table_info(users)`).all() as { name: string }[];
      expect(columns.map((column) => column.name)).toContain("display_name");
    } finally {
      db.close();
    }
  });

  it("applies an ALTER foreign key once the target table exists", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ef-110-fk-"));
    try {
      const template = path.join(root, "template.sqlite");
      createTemplateDatabase(template, "CREATE TABLE users (id TEXT PRIMARY KEY);");
      const engine = linter([], ["users"]);
      const orders = named(engine, {
        featureId: "F-Orders",
        slug: "orders_user",
        sql: [
          "CREATE TABLE orders (id TEXT PRIMARY KEY, user_id TEXT);",
          "ALTER TABLE orders ADD CONSTRAINT orders_user_fk FOREIGN KEY (user_id) REFERENCES users(id);",
        ].join("\n"),
      });
      const report = new MigrationRehearsalChecker().rehearse({
        templatePath: template,
        migrations: [orders],
        destPath: path.join(root, "clone.sqlite"),
      });
      expect(report.ok).toBe(true);
      expect(report.applied).toEqual([orders.id]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("reads migration files back from three feature refs", () => {
    const harness = createHarness();
    harnesses.push(harness);
    const engine = new MigrationConflictLinter();
    const features = [
      ["F-Menu", "F-Menu", "CREATE TABLE dietary_tags (id TEXT PRIMARY KEY);"],
      ["F-Orders", "F-Orders", "CREATE TABLE orders (id TEXT PRIMARY KEY);"],
      ["F-Email", "F-Email", "CREATE TABLE email_log (id TEXT PRIMARY KEY);"],
    ] as const;
    for (const [featureId, slug, sql] of features) {
      harness.manager.openFeature({ featureId, featureSlug: slug, waveId: "wave-3" });
      const file = named(engine, { featureId, slug: slug.toLowerCase(), sql });
      harness.manager.commitFeatureFiles(featureId, { [file.path]: file.sql }, `migration ${slug}`);
    }
    const records = harness.manager.listActive();
    expect(records).toHaveLength(3);
    const collected = engine.collectFromRepo(
      harness.repo,
      records.map((record) => ({ featureId: record.featureId, ref: record.ref })),
      "timestamp-hash",
    );
    expect(collected.map((file) => file.featureId).sort()).toEqual(["F-Email", "F-Menu", "F-Orders"]);
    expect(engine.lint(collected, 3).findings).toEqual([]);
  });
});
