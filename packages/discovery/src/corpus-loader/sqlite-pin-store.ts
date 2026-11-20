import { DatabaseSync } from "node:sqlite";
import { CorpusPinIntegrityError } from "./errors.js";
import type { CorpusProjectStatePort, ScopeCriterionSnapshot, SettledDecisionSnapshot } from "./types.js";

const META_DDL = `CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT, WITHOUT ROWID`;

export class SqliteCorpusPinStore implements CorpusProjectStatePort {
  private constructor(private readonly db: DatabaseSync) {}

  static open(filePath: string): SqliteCorpusPinStore {
    const db = new DatabaseSync(filePath);
    db.exec(META_DDL);
    return new SqliteCorpusPinStore(db);
  }

  close(): void {
    this.db.close();
  }

  getMeta(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
    if (!row) return null;
    const value = row.value;
    return typeof value === "string" ? value : null;
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO meta(key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  }

  listSettledDecisions(): SettledDecisionSnapshot[] {
    if (!this.hasTable("nodes")) return [];
    const rows = this.db.prepare("SELECT id, fields FROM nodes ORDER BY id").all();
    const decisions: SettledDecisionSnapshot[] = [];
    for (const row of rows) {
      if (typeof row.id !== "string" || typeof row.fields !== "string") continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(row.fields);
      } catch {
        throw new CorpusPinIntegrityError(`Decision node ${row.id} has unreadable fields`);
      }
      if (!isRecord(parsed) || parsed.status !== "settled") continue;
      if (typeof parsed.value !== "string" || typeof parsed.basis !== "string") continue;
      const questionId = typeof parsed.question_id === "string" ? parsed.question_id : "";
      const criterion = typeof parsed.criterion === "string" ? parsed.criterion : "";
      decisions.push({
        decisionId: row.id,
        questionId,
        criterion,
        value: parsed.value,
        basis: parsed.basis,
      });
    }
    return decisions;
  }

  listScopeCriteria(): ScopeCriterionSnapshot[] {
    if (!this.hasTable("scope_criteria")) return [];
    const rows = this.db
      .prepare(
        `SELECT work_item, scope_rev, decision, needed_for_planning, critical
         FROM scope_criteria
         ORDER BY work_item, scope_rev, decision`,
      )
      .all();
    return rows.map((row) => ({
      workItem: requireText(row.work_item, "work_item"),
      scopeRev: requireInteger(row.scope_rev, "scope_rev"),
      decision: requireText(row.decision, "decision"),
      neededForPlanning: requireInteger(row.needed_for_planning, "needed_for_planning"),
      critical: requireInteger(row.critical, "critical"),
    }));
  }

  private hasTable(name: string): boolean {
    const row = this.db
      .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name);
    return row !== undefined;
  }
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new CorpusPinIntegrityError(`scope_criteria.${label} is not text`);
  }
  return value;
}

function requireInteger(value: unknown, label: string): number {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "bigint") return Number(value);
  throw new CorpusPinIntegrityError(`scope_criteria.${label} is not an integer`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
