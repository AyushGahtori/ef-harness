import { SchemaInvariantError } from "./errors.js";
import type { MigrationDefinition, SqliteConnection } from "./types.js";

export const STATE_V2_MIGRATION_NAME = "state-v2-edge-types-and-tables";
export const CODE_INDEX_V2_MIGRATION_NAME = "code-index-v2-module-cards";
export const CODE_INDEX_BASELINE_NAME = "code-index-schema-v1";

/** Audit table shared by every database. Code-index v1 SQL does not create it. */
export const SCHEMA_MIGRATIONS_DDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('additive','rebuild','data')),
  app_version TEXT NOT NULL,
  applied_at INTEGER NOT NULL
) STRICT
`;

const STATE_V2_SQL = `
INSERT OR IGNORE INTO edge_types(type, invalidates) VALUES
  ('expands', 1),
  ('contradicts', 1),
  ('informs', 1);

CREATE TABLE IF NOT EXISTS canvas_layout (
  node_id TEXT NOT NULL REFERENCES nodes(id),
  view_level INTEGER NOT NULL CHECK (view_level BETWEEN 1 AND 4),
  x REAL NOT NULL,
  y REAL NOT NULL,
  pinned_by_user INTEGER NOT NULL CHECK (pinned_by_user IN (0, 1)),
  PRIMARY KEY (node_id, view_level)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS investigations (
  id TEXT PRIMARY KEY,
  stage TEXT NOT NULL CHECK (stage IN (
    'INTAKE',
    'CLEAN_REPRO',
    'QUARANTINED_LOCALIZE',
    'PROVEN_MINIMAL_FLIP_ROOT_CAUSE',
    'SCOPED_FIX',
    'PERMANENT_REPRO_AND_MECHANISM_TESTS'
  )),
  symptom_summary TEXT NOT NULL DEFAULT '',
  repro_command TEXT,
  hypothesis_ledger TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(hypothesis_ledger)),
  root_cause TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS sweep_symbol_maps (
  sweep_id TEXT NOT NULL,
  old_path TEXT NOT NULL,
  new_path TEXT NOT NULL,
  old_symbol TEXT NOT NULL,
  new_symbol TEXT NOT NULL,
  persisted_exclusions TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(persisted_exclusions)),
  recorded_at INTEGER NOT NULL,
  PRIMARY KEY (sweep_id, old_path, old_symbol)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS stop_events (
  id TEXT PRIMARY KEY,
  trigger TEXT NOT NULL CHECK (trigger IN ('budget_100','window_exhausted','user_stop','disk_red')),
  occurred_at INTEGER NOT NULL,
  checkpoint_shas TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(checkpoint_shas)),
  recovery_option TEXT
) STRICT, WITHOUT ROWID;
`;

const CODE_INDEX_MODULE_CARDS_DDL = `
CREATE TABLE IF NOT EXISTS module_cards (
  file_path TEXT NOT NULL,
  file_content_sha256 TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  card_json TEXT NOT NULL CHECK (json_valid(card_json)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (file_path, file_content_sha256, prompt_version)
) STRICT, WITHOUT ROWID;
`;

const SEEDED_EDGE_TYPES = ["expands", "contradicts", "informs"] as const;
const STATE_V2_TABLES = ["canvas_layout", "investigations", "sweep_symbol_maps", "stop_events"] as const;

function flag(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return Number.NaN;
}

function assertTable(conn: SqliteConnection, name: string): void {
  const row = conn.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
  if (!row) throw new SchemaInvariantError(`migration did not create ${name}`);
}

export const stateV2Migration: MigrationDefinition = {
  kind: "additive",
  version: 2,
  name: STATE_V2_MIGRATION_NAME,
  targetDb: "state",
  apply(conn) {
    conn.exec(STATE_V2_SQL);
  },
  check(conn) {
    for (const type of SEEDED_EDGE_TYPES) {
      const row = conn.prepare("SELECT invalidates FROM edge_types WHERE type = ?").get(type);
      if (flag(row?.invalidates) !== 1) {
        throw new SchemaInvariantError(`edge type ${type} was not seeded`);
      }
    }
    for (const table of STATE_V2_TABLES) assertTable(conn, table);
  },
};

export const codeIndexV2Migration: MigrationDefinition = {
  kind: "additive",
  version: 2,
  name: CODE_INDEX_V2_MIGRATION_NAME,
  targetDb: "code-index",
  apply(conn) {
    conn.exec(SCHEMA_MIGRATIONS_DDL);
    conn.exec(CODE_INDEX_MODULE_CARDS_DDL);
  },
  check(conn) {
    assertTable(conn, "schema_migrations");
    assertTable(conn, "module_cards");
  },
};
