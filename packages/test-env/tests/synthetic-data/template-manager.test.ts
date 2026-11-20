import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  SimulatedEmbeddedPostgres,
  TemplateDatabaseManager,
} from "../../src/synthetic-data/index.js";
import { demoSchema, migrationsFor, recipe } from "./fixture.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    relax(directory);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("template database manager", () => {
  it("deduplicates concurrent builds, locks the template, and clones without sharing writes", async () => {
    const root = tempDir();
    let releaseGate: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    let entered = 0;
    const manager = new TemplateDatabaseManager({
      projectId: "project",
      rootDir: root,
      dialect: "sqlite",
      buildGate: async () => {
        entered += 1;
        await gate;
      },
    });
    const request = templateRequest(42);
    const first = manager.ensureTemplate(request);
    const second = manager.ensureTemplate(request);
    await waitFor(() => manager.stats().buildsStarted === 1);
    expect(manager.stats().dedupedWaits).toBe(1);
    expect(entered).toBe(1);
    releaseGate?.();
    const [left, right] = await Promise.all([first, second]);
    expect(left.templateKey).toBe(right.templateKey);
    expect(left.locked).toBe(true);
    expect(manager.stats().buildsStarted).toBe(1);
    await expect(fs.promises.open(left.location, "r+")).rejects.toThrow();

    const clone = await manager.cloneFromTemplate(left, "91");
    const cloneDb = new DatabaseSync(clone.location);
    const before = cloneDb.prepare("SELECT name FROM users WHERE id = 1").get()?.name;
    cloneDb.prepare("UPDATE users SET name = ? WHERE id = 1").run("changed-clone");
    cloneDb.close();
    const templateDb = new DatabaseSync(left.location, { readOnly: true });
    expect(templateDb.prepare("SELECT name FROM users WHERE id = 1").get()?.name).toBe(before);
    templateDb.close();
    await clone.release();
    await clone.release();
  });

  it("rebuilds only when the recipe or migrations change and prunes unused templates", async () => {
    const root = tempDir();
    const manager = new TemplateDatabaseManager({
      projectId: "project",
      rootDir: root,
      dialect: "sqlite",
      keep: 5,
    });
    const first = await manager.ensureTemplate(templateRequest(1));
    const again = await manager.ensureTemplate(templateRequest(1));
    expect(again.templateKey).toBe(first.templateKey);
    expect(manager.stats().buildsStarted).toBe(1);
    const handles = [first];
    for (let seed = 2; seed <= 6; seed += 1) {
      handles.push(await manager.ensureTemplate(templateRequest(seed)));
    }
    expect(manager.listTemplates()).toHaveLength(6);
    const oldest = manager.listTemplates().at(-1);
    expect(oldest).toBeDefined();
    if (!oldest) return;
    const clone = await manager.cloneFromTemplate(oldest, "keep");
    const blocked = await manager.pruneOldTemplates({ keep: 5 });
    expect(blocked.skipped).toContain(oldest.name);
    expect(blocked.removed).not.toContain(oldest.name);
    await clone.release();
    const pruned = await manager.pruneOldTemplates({ keep: 5 });
    expect(pruned.removed).toEqual([oldest.name]);
    expect(manager.listTemplates().some((template) => template.name === oldest.name)).toBe(false);
  });

  it("prewarms a template in the background", async () => {
    const root = tempDir();
    const manager = new TemplateDatabaseManager({
      projectId: "project",
      rootDir: root,
      dialect: "sqlite",
    });
    manager.prewarmTemplate(templateRequest(9));
    await manager.whenIdle();
    expect(manager.stats().ready).toBe(1);
    expect(manager.takePrewarmErrors()).toEqual([]);
  });

  it("serializes different template builds on one disk lane", async () => {
    const root = tempDir();
    let current = 0;
    let maxConcurrent = 0;
    const manager = new TemplateDatabaseManager({
      projectId: "project",
      rootDir: root,
      dialect: "sqlite",
      buildGate: async () => {
        current += 1;
        maxConcurrent = Math.max(maxConcurrent, current);
        await new Promise((resolve) => setTimeout(resolve, 30));
        current -= 1;
      },
    });
    await Promise.all([manager.ensureTemplate(templateRequest(1)), manager.ensureTemplate(templateRequest(2))]);
    expect(maxConcurrent).toBe(1);
    expect(manager.stats().buildsStarted).toBe(2);
  });
});

describe("postgres template clone port", () => {
  it("terminates backends and locks the template before publishing it", async () => {
    const root = tempDir();
    const postgres = new SimulatedEmbeddedPostgres(path.join(root, "pg"));
    const manager = new TemplateDatabaseManager({
      projectId: "project",
      rootDir: root,
      dialect: "postgres",
      postgres,
    });
    const first = manager.ensureTemplate(templateRequest(4));
    const second = manager.ensureTemplate(templateRequest(4));
    const [left, right] = await Promise.all([first, second]);
    expect(left.name).toBe(right.name);
    expect(postgres.events.filter((event) => event.startsWith("create:"))).toHaveLength(1);
    const readyAt = postgres.events.join("\n");
    expect(readyAt.indexOf(`terminate:${left.name}`)).toBeGreaterThan(-1);
    expect(readyAt.indexOf(`terminate:${left.name}`)).toBeLessThan(readyAt.indexOf(`allow:${left.name}:false`));
    await expect(postgres.connectDatabase(left.name)).rejects.toThrow(/not currently accepting connections/);
    const clone = await manager.cloneFromTemplate(left, "91");
    expect(clone.name).toBe("env_91");
    const session = await postgres.connectDatabase(clone.name);
    const count = await session.query("SELECT count(*) AS c FROM users");
    expect(Number(count.rows[0]?.c)).toBeGreaterThanOrEqual(3);
    const names = await session.query("SELECT name FROM users");
    expect(names.rows.some((row) => String(row.name).includes("🍜"))).toBe(true);
    await session.close();
    await clone.release();
  });

  it("refuses to clone a template that still has a builder connection", async () => {
    const root = tempDir();
    const postgres = new SimulatedEmbeddedPostgres(path.join(root, "pg"));
    const admin = await postgres.connectAdmin();
    await admin.query("CREATE DATABASE tpl_open");
    await admin.close();
    const builder = await postgres.connectDatabase("tpl_open");
    const cloner = await postgres.connectAdmin();
    await expect(cloner.query('CREATE DATABASE env_open TEMPLATE "tpl_open"')).rejects.toThrow(
      /being accessed by other users/,
    );
    await builder.close();
    await cloner.close();
  });
});

function templateRequest(seed: number) {
  return {
    migrations: migrationsFor(demoSchema),
    schema: demoSchema,
    seedRecipe: recipe(seed),
  };
}

function tempDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ef-task-052-"));
  directories.push(directory);
  return directory;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 2000) throw new Error("timed out waiting for template build");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function relax(directory: string): void {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) relax(full);
    else fs.chmodSync(full, 0o666);
  }
}
