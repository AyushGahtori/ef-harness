import { DatabaseSync } from "node:sqlite";
import { loadCanonicalSqlAsset, registerEfSearchText, stateV2Sql } from "@ef-harness/db";

/**
 * Opens one state.db with the canonical schema and the additive v2 migration.
 * Steering messages share this file. They do not create a second database.
 */
export function openSteeringState(location: string): DatabaseSync {
  const db = new DatabaseSync(location);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  registerEfSearchText(db);
  const nodes = db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'nodes'").get();
  if (!nodes) {
    db.exec(loadCanonicalSqlAsset("stateSql"));
    db.exec("INSERT INTO meta(key, value) VALUES ('last_rev', '0') ON CONFLICT(key) DO NOTHING");
    db.exec(
      "INSERT OR IGNORE INTO project_runtime(id, state, current_wave, paused, updated_rev) VALUES (1, 'WAVES', 1, 0, 0)",
    );
  }
  db.exec(stateV2Sql());
  return db;
}
