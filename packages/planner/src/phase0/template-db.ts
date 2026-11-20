import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { sha256 } from "./hash.js";
import type { MigrationResult, TemplateDbSeederPort } from "./ports.js";

/** Builds a template database in a temp directory and proves up/down plus clone stability. */
export class LocalTemplateDbSeeder implements TemplateDbSeederPort {
  async migrate(repoPath: string): Promise<MigrationResult> {
    const upPath = path.join(repoPath, "db", "migrations", "0001_up.sql");
    const downPath = path.join(repoPath, "db", "migrations", "0001_down.sql");
    if (!fs.existsSync(upPath) || !fs.existsSync(downPath)) {
      return { ok: false, templateDbHash: "", error: "missing template migration" };
    }
    const up = fs.readFileSync(upPath, "utf8");
    const down = fs.readFileSync(downPath, "utf8");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-p0-db-"));
    const template = path.join(dir, "template.sqlite");
    const clone = path.join(dir, "clone.sqlite");
    try {
      applySql(template, up);
      const before = sha256(fs.readFileSync(template));
      fs.copyFileSync(template, clone);
      applySql(clone, down);
      if (tableExists(clone, "phase0_skeleton")) {
        return { ok: false, templateDbHash: before, error: "down migration left phase0_skeleton" };
      }
      applySql(clone, up);
      if (!tableExists(clone, "phase0_skeleton")) {
        return { ok: false, templateDbHash: before, error: "fresh apply did not create phase0_skeleton" };
      }
      const after = sha256(fs.readFileSync(template));
      if (before !== after) {
        return { ok: false, templateDbHash: before, error: "template database changed during clone" };
      }
      return { ok: true, templateDbHash: before, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, templateDbHash: "", error: message };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

function applySql(file: string, sql: string): void {
  const db = new DatabaseSync(file);
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
}

function tableExists(file: string, name: string): boolean {
  const db = new DatabaseSync(file);
  try {
    const row = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name) as
      | { name: string }
      | undefined;
    return Boolean(row);
  } finally {
    db.close();
  }
}
