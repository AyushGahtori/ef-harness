import { entryKey } from "./types.js";
import type {
  FrozenVocabularySource,
  VocabularyEntry,
  VocabularySource,
  VocabularyStore,
} from "./types.js";

/**
 * Column mapping onto frozen `schema/global.sql` `vocabulary`.
 * The CHECK constraint cannot store Task 158's source enum or `suppressed`,
 * so those fields travel in a JSON settings sidecar until an additive migration lands.
 */
export const VOCABULARY_SIDECAR_SETTING_KEY = "dictation.vocabulary.sidecar.v1";

export interface FrozenVocabularyRow {
  readonly term: string;
  readonly project: string;
  readonly weight: number;
  readonly source: FrozenVocabularySource;
  readonly heard_as: string | null;
  readonly hits: number;
  readonly updated_at: number;
}

export interface VocabularySidecarRow {
  readonly source: VocabularySource;
  readonly suppressed: boolean;
  readonly occurrence_ids: readonly string[];
  readonly heard_forms: readonly string[];
  readonly correction_from: string | null;
}

export interface GlobalDbVocabularyDriver {
  upsertVocabulary(row: FrozenVocabularyRow): void;
  deleteVocabulary(project: string, term: string): void;
  listVocabulary(): readonly FrozenVocabularyRow[];
  readSetting(key: string): string | null;
  writeSetting(key: string, value: string): void;
}

interface SidecarFile {
  readonly version: 1;
  readonly rows: Readonly<Record<string, VocabularySidecarRow>>;
}

export function frozenSourceFor(source: VocabularySource): FrozenVocabularySource {
  switch (source) {
    case "user_correction":
      return "correction";
    case "user_manual":
      return "glossary";
    case "tech_stack":
      return "dependency";
    case "entity_auto":
      return "pattern";
  }
}

export function logicalSourceFor(source: FrozenVocabularySource): VocabularySource {
  switch (source) {
    case "correction":
      return "user_correction";
    case "glossary":
      return "user_manual";
    case "dependency":
    case "global":
      return "tech_stack";
    case "pattern":
      return "entity_auto";
  }
}

export function toFrozenVocabularyRow(entry: VocabularyEntry): FrozenVocabularyRow {
  return {
    term: entry.term,
    project: entry.project_id,
    weight: entry.weight,
    source: frozenSourceFor(entry.source),
    heard_as: entry.correction_from,
    hits: entry.occurrence_count,
    updated_at: entry.last_used_at,
  };
}

export function sidecarFor(entry: VocabularyEntry): VocabularySidecarRow {
  return {
    source: entry.source,
    suppressed: entry.suppressed,
    occurrence_ids: entry.occurrence_ids,
    heard_forms: entry.heard_forms,
    correction_from: entry.correction_from,
  };
}

function emptySidecar(): SidecarFile {
  return { version: 1, rows: {} };
}

function readSidecar(driver: GlobalDbVocabularyDriver): SidecarFile {
  const raw = driver.readSetting(VOCABULARY_SIDECAR_SETTING_KEY);
  if (!raw) return emptySidecar();
  const parsed = JSON.parse(raw) as SidecarFile;
  if (parsed.version !== 1 || parsed.rows === undefined || typeof parsed.rows !== "object") {
    return emptySidecar();
  }
  return parsed;
}

export function entryFromFrozenRow(row: FrozenVocabularyRow, sidecar: VocabularySidecarRow | null): VocabularyEntry {
  const source = sidecar?.source ?? logicalSourceFor(row.source);
  const correctionFrom = sidecar?.correction_from ?? row.heard_as;
  return {
    term: row.term,
    project_id: row.project,
    weight: row.weight,
    source,
    correction_from: correctionFrom,
    heard_forms: sidecar?.heard_forms ?? (correctionFrom ? [correctionFrom] : []),
    occurrence_count: row.hits,
    occurrence_ids: sidecar?.occurrence_ids ?? [],
    last_used_at: row.updated_at,
    suppressed: sidecar?.suppressed ?? false,
  };
}

/** Persists logical vocabulary rows through the frozen `vocabulary` table plus sidecar. */
export class FrozenGlobalVocabularyStore implements VocabularyStore {
  constructor(private readonly driver: GlobalDbVocabularyDriver) {}

  get(projectId: string, term: string): VocabularyEntry | null {
    return this.list().find((entry) => entry.project_id === projectId && entry.term === term) ?? null;
  }

  list(): readonly VocabularyEntry[] {
    const sidecar = readSidecar(this.driver);
    return this.driver.listVocabulary().map((row) => {
      const extra = sidecar.rows[entryKey(row.project, row.term)] ?? null;
      return entryFromFrozenRow(row, extra);
    });
  }

  upsert(entry: VocabularyEntry): void {
    this.driver.upsertVocabulary(toFrozenVocabularyRow(entry));
    const sidecar = readSidecar(this.driver);
    const rows = { ...sidecar.rows, [entryKey(entry.project_id, entry.term)]: sidecarFor(entry) };
    this.driver.writeSetting(
      VOCABULARY_SIDECAR_SETTING_KEY,
      JSON.stringify({ version: 1, rows } satisfies SidecarFile),
    );
  }

  delete(projectId: string, term: string): void {
    this.driver.deleteVocabulary(projectId, term);
    const sidecar = readSidecar(this.driver);
    const rows = { ...sidecar.rows };
    delete rows[entryKey(projectId, term)];
    this.driver.writeSetting(
      VOCABULARY_SIDECAR_SETTING_KEY,
      JSON.stringify({ version: 1, rows } satisfies SidecarFile),
    );
  }
}

export class MemoryGlobalDbVocabularyDriver implements GlobalDbVocabularyDriver {
  private readonly rows = new Map<string, FrozenVocabularyRow>();
  private readonly settings = new Map<string, string>();

  upsertVocabulary(row: FrozenVocabularyRow): void {
    this.rows.set(entryKey(row.project, row.term), row);
  }

  deleteVocabulary(project: string, term: string): void {
    this.rows.delete(entryKey(project, term));
  }

  listVocabulary(): readonly FrozenVocabularyRow[] {
    return [...this.rows.values()];
  }

  readSetting(key: string): string | null {
    return this.settings.get(key) ?? null;
  }

  writeSetting(key: string, value: string): void {
    this.settings.set(key, value);
  }
}
