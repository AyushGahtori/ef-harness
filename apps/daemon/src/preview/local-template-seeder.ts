import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { TemplateCloneResult, TemplateDbSeeder, TestEnvOrchestrator } from "./ports.js";

const SEED_SQL = `
CREATE TABLE demo_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO demo_meta (key, value) VALUES ('seed', 'functional');
CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  note TEXT NOT NULL
);
CREATE TABLE _ef_preview_migrations (
  id TEXT PRIMARY KEY,
  sql TEXT NOT NULL,
  applied_at_ms INTEGER NOT NULL
);
`;

function writeSeedFile(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) fs.rmSync(file, { force: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = DELETE");
  db.exec(SEED_SQL);
  db.close();
}

/**
 * Functional preview seed, separate from Task 052 automated test templates.
 * Swap `cloneFunctionalSeed` for `TemplateDatabaseManager.cloneFromTemplate`.
 */
export class LocalTemplateDbSeeder implements TemplateDbSeeder {
  constructor(private readonly root: string) {}

  snapshotPath(projectId: string): string {
    return path.join(this.root, "seed-snapshots", projectId, "functional.sqlite");
  }

  cloneFunctionalSeed(projectId: string, destPath: string): TemplateCloneResult {
    const snapshotPath = this.snapshotPath(projectId);
    if (path.resolve(snapshotPath) === path.resolve(destPath)) {
      throw new Error("refusing to clone a seed snapshot onto itself");
    }
    if (!fs.existsSync(snapshotPath)) writeSeedFile(snapshotPath);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(snapshotPath, destPath);
    return { snapshotId: `${projectId}:functional`, snapshotPath };
  }
}

/**
 * Automated test template location. Preview reset must never write this file.
 * Swap for Task 050 `TestEnvOrchestrator` template databases.
 */
export class LocalTestEnvOrchestrator implements TestEnvOrchestrator {
  constructor(private readonly root: string) {}

  templateDatabasePath(projectId: string): string {
    return path.join(this.root, "test-templates", projectId, "tpl_functional.sqlite");
  }

  ensureTemplate(projectId: string): string {
    const file = this.templateDatabasePath(projectId);
    if (!fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "test-template-not-preview\n", "utf8");
    }
    return file;
  }
}
