import type { GlobalBrokerDb } from "@ef-harness/db";
import { FROZEN_VOCABULARY_SOURCES, type FrozenVocabularySource } from "./types.js";
import type { FrozenVocabularyRow, GlobalDbVocabularyDriver } from "./frozen-schema-adapter.js";

type VocabularyBroker = Pick<GlobalBrokerDb, "writer" | "getSetting" | "setSetting">;

/**
 * `global.db` `vocabulary` + `settings` through `GlobalBrokerDb`.
 * Learned terms survive process restart. This driver does not keep a row map.
 */
export class GlobalBrokerVocabularyDriver implements GlobalDbVocabularyDriver {
  constructor(private readonly db: VocabularyBroker) {}

  upsertVocabulary(row: FrozenVocabularyRow): void {
    this.db.writer.transaction(() => {
      this.db.writer.run(
        `INSERT INTO vocabulary(term, project, weight, source, heard_as, hits, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(term, project) DO UPDATE SET
           weight = excluded.weight,
           source = excluded.source,
           heard_as = excluded.heard_as,
           hits = excluded.hits,
           updated_at = excluded.updated_at`,
        [row.term, row.project, row.weight, row.source, row.heard_as, row.hits, row.updated_at],
      );
    });
  }

  deleteVocabulary(project: string, term: string): void {
    this.db.writer.transaction(() => {
      this.db.writer.run("DELETE FROM vocabulary WHERE project = ? AND term = ?", [project, term]);
    });
  }

  listVocabulary(): readonly FrozenVocabularyRow[] {
    const rows = this.db.writer.all(
      "SELECT term, project, weight, source, heard_as, hits, updated_at FROM vocabulary ORDER BY project, term",
    );
    return rows.map((row: unknown) => frozenRow(row));
  }

  readSetting(key: string): string | null {
    const value = this.db.getSetting(key);
    if (value === undefined || value === null) return null;
    return JSON.stringify(value);
  }

  writeSetting(key: string, value: string): void {
    this.db.setSetting(key, JSON.parse(value) as unknown);
  }
}

function frozenRow(value: unknown): FrozenVocabularyRow {
  const row = asRecord(value);
  const source = textField(row, "source");
  if (!isFrozenSource(source)) {
    throw new Error(`vocabulary source ${source} is not in the frozen CHECK list`);
  }
  return {
    term: textField(row, "term"),
    project: textField(row, "project"),
    weight: intField(row, "weight"),
    source,
    heard_as: nullableText(row, "heard_as"),
    hits: intField(row, "hits"),
    updated_at: intField(row, "updated_at"),
  };
}

function isFrozenSource(value: string): value is FrozenVocabularySource {
  return (FROZEN_VOCABULARY_SOURCES as readonly string[]).includes(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("vocabulary row is not an object");
  }
  return value as Record<string, unknown>;
}

function textField(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`vocabulary ${key} is not text`);
  return value;
}

function nullableText(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error(`vocabulary ${key} is not text`);
  return value;
}

function intField(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "bigint") return Number(value);
  throw new Error(`vocabulary ${key} is not an integer`);
}
