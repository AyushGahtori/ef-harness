import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  DependencyIntentAggregator,
  LocalSkeletonLock,
  MigrationIntentAndConflictLinter,
  MigrationRehearsalChecker,
  SharedFileDriftMonitor,
  SmartBranchFreshnessSync,
  createTemplateDatabase,
} from "../../src/feature-branches/index.js";
import type { DependencyIntent, MigrationFile } from "../../src/feature-branches/index.js";
import { isAncestor, revParse } from "../../src/feature-branches/git.js";
import { createHarness, writeSyntheticLockfile, type Harness } from "./fixture.js";

const open: Harness[] = [];

afterEach(() => {
  for (const harness of open.splice(0)) harness.close();
});

describe("three simultaneous feature branches", { timeout: 40_000 }, () => {
  it("lints concurrent migrations, serializes dependency intents, and syncs only when freshness requires it", () => {
    const harness = createHarness();
    open.push(harness);
    const at = new Date(Date.UTC(2026, 10, 19, 1, 15, 0));
    const engine = new MigrationIntentAndConflictLinter(
      new LocalSkeletonLock([{ kind: "column", name: "display_name", table: "users" }]),
      ["users"],
    );
    const specs = [
      {
        featureId: "F-Menu",
        slug: "F-Menu",
        at,
        sql: [
          "CREATE TABLE dietary_tags (id TEXT PRIMARY KEY);",
          "CREATE INDEX users_display_name ON users (display_name);",
        ].join("\n"),
        fileSlug: "add_menu_tags",
      },
      {
        featureId: "F-Orders",
        slug: "F-Orders",
        at: new Date(at.getTime() - 5000),
        sql: "CREATE TABLE orders (id TEXT PRIMARY KEY, tag_id TEXT REFERENCES dietary_tags(id));",
        fileSlug: "orders_fk",
      },
      {
        featureId: "F-Email",
        slug: "F-Email",
        at: new Date(at.getTime() + 1000),
        sql: "ALTER TABLE users DROP COLUMN display_name;",
        fileSlug: "drop_display_name",
      },
    ] as const;
    const files: MigrationFile[] = [];
    for (const spec of specs) {
      harness.manager.openFeature({ featureId: spec.featureId, featureSlug: spec.slug, waveId: "wave-3" });
      const file = engine.nameMigration({
        featureId: spec.featureId,
        slug: spec.fileSlug,
        sql: spec.sql,
        at: spec.at,
      });
      files.push(file);
      harness.manager.commitFeatureFiles(spec.featureId, { [file.path]: file.sql }, spec.fileSlug);
    }
    expect(harness.manager.listActive()).toHaveLength(3);
    expect(new Set(files.map((file) => file.path)).size).toBe(3);
    const menu = files[0];
    const orders = files[1];
    expect(menu && orders && menu.timestamp === "20261119011500" && orders.timestamp === "20261119011455").toBe(true);

    const collected = engine.collectFromRepo(
      harness.repo,
      harness.manager.listActive().map((record) => ({ featureId: record.featureId, ref: record.ref })),
      "timestamp-hash",
    );
    const linted = engine.lint(collected, 3);
    expect(linted.findings.some((finding) => finding.code === "fk_order" && finding.objectName === "dietary_tags")).toBe(
      true,
    );
    expect(linted.findings.some((finding) => finding.code === "incompatible_column" && finding.objectName === "users.display_name")).toBe(
      true,
    );
    expect(linted.findings.some((finding) => finding.code === "destructive_skeleton")).toBe(true);
    expect(linted.restamped.some((file) => file.featureId === "F-Orders" && file.timestamp > (menu?.timestamp ?? ""))).toBe(
      true,
    );

    harness.manager.commitFeatureFiles("F-Menu", { "src/shared/format.ts": "export const format = 'menu';\n" }, "menu helper");
    harness.manager.commitFeatureFiles("F-Email", { "src/shared/format.ts": "export const format = 'email';\n" }, "email helper");
    harness.manager.registerWriteScope("F-Menu", ["src/menu/"]);
    harness.manager.registerWriteScope("F-Email", ["src/email/"]);
    const drift = new SharedFileDriftMonitor().scan({
      repo: harness.repo,
      branches: harness.manager.listActive(),
      scopes: {
        "F-Menu": harness.manager.writeScope("F-Menu"),
        "F-Email": harness.manager.writeScope("F-Email"),
        "F-Orders": [],
      },
    });
    expect(drift.some((warning) => warning.path === "src/shared/format.ts" && warning.featureIds.length === 2)).toBe(true);

    const template = path.join(harness.root, "template.sqlite");
    createTemplateDatabase(template, "CREATE TABLE users (id TEXT PRIMARY KEY, display_name TEXT);");
    const rehearsal = new MigrationRehearsalChecker().rehearse({
      templatePath: template,
      migrations: linted.ordered,
      destPath: path.join(harness.root, "clone.sqlite"),
    });
    expect(rehearsal.ok).toBe(true);
    const db = new DatabaseSync(rehearsal.clonePath);
    try {
      const names = db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
        .all()
        .map((row) => (row as { name: string }).name);
      expect(names).toEqual(["dietary_tags", "orders", "users"]);
    } finally {
      db.close();
    }

    const ordersHead = harness.manager.read("F-Orders").headSha;
    const freshness = new SmartBranchFreshnessSync(harness.manager);
    expect(freshness.applyDue("F-Orders").action).toBe("skipped");
    expect(harness.manager.read("F-Orders").headSha).toBe(ordersHead);

    const before = revParse(harness.repo, harness.manager.integrationRef);
    const aggregator = new DependencyIntentAggregator({
      repo: harness.repo,
      state: harness.state,
      worktreeRoot: path.join(harness.root, "wt"),
      branches: harness.manager,
      freshness,
      supplyChain: { vetDependencyIntent: () => ({ decision: "allow", reason: "test allowlist" }) },
      installer: { install: writeSyntheticLockfile },
    });
    const intents: DependencyIntent[] = [
      {
        featureId: "F-Menu",
        packageName: "zod",
        versionRange: "^3.23.8",
        devOnly: false,
        rationale: "parse menu payloads",
      },
      {
        featureId: "F-Orders",
        packageName: "date-fns",
        versionRange: "^3.6.0",
        devOnly: false,
        rationale: "format order times",
      },
    ];
    const aggregated = aggregator.aggregate(intents);
    expect(aggregated.status).toBe("applied");
    expect(aggregated.packages.map((item) => item.packageName)).toEqual(["date-fns", "zod"]);
    expect(aggregated.commitSha).toBeTruthy();
    const integration = revParse(harness.repo, harness.manager.integrationRef);
    expect(integration).toBe(aggregated.commitSha);
    expect(isAncestor(harness.repo, before, integration)).toBe(true);
    expect(aggregated.propagated.map((item) => item.featureId).sort()).toEqual(["F-Email", "F-Menu", "F-Orders"]);
    expect(aggregated.propagated.every((item) => item.action === "synced")).toBe(true);
    for (const featureId of ["F-Menu", "F-Email", "F-Orders"]) {
      expect(isAncestor(harness.repo, integration, harness.manager.read(featureId).headSha)).toBe(true);
      expect(harness.manager.read(featureId).pinnedBaseCommitSha).not.toBe(harness.manager.read(featureId).headSha);
    }
    aggregator.close();
  }, 40_000);
});
