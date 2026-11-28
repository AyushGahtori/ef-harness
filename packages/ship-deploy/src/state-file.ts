import { loadCanonicalSqlAsset, openDatabase, stateV2Sql, type SqliteConnection } from "@ef-harness/db";

/** Canonical `state.db` writer. Schema and `ef_search_text` come from `@ef-harness/db`. */
export function openShipStateFile(file: string): SqliteConnection {
  const db = openDatabase({ location: file, role: "state" });
  const meta = db.get("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'meta'");
  if (meta === undefined || meta === null) {
    db.exec(loadCanonicalSqlAsset("stateSql"));
  }
  const details = db.get(
    "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'ship_run_details'",
  );
  if (details === undefined || details === null) {
    db.exec(stateV2Sql());
  }
  return db;
}
