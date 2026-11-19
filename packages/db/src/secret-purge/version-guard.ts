import type { DatabaseSync } from "node:sqlite";

import { loadSchemaAsset, sqlText } from "./sqlite-util.js";

/**
 * Sanctioned purge transaction protocol.
 *
 * `nodes_version_guard` aborts any meaning change that does not set
 * `version = old.version + 1`. Secret purge is the one sanctioned history
 * rewrite, and it must keep `nodes.version` stable so downstream read sets
 * stay coherent. The old content hash to new content hash map is stored in
 * `redactions.hash_map_artifact` instead of bumping the version.
 *
 * Protocol, inside one immediate transaction:
 * 1. Confirm `nodes_version_guard` exists.
 * 2. `DROP TRIGGER nodes_version_guard`.
 * 3. Update `nodes.title/text/fields/content_hash` without changing `version`.
 * 4. Update matching historical and current `node_versions` rows in place.
 *    `nodes_au` does not fire when `version` is unchanged, so FTS is rebuilt
 *    by the caller after commit.
 * 5. Recreate `nodes_version_guard` from the exact statement in schema/state.sql.
 * 6. Commit, then probe the trigger with a version-stable update that must abort.
 */
export function readNodesVersionGuardSql(): string {
  const schema = loadSchemaAsset("state.sql");
  const match = /CREATE TRIGGER nodes_version_guard[\s\S]*?\nEND;/.exec(schema);
  if (!match?.[0]) {
    throw new Error("nodes_version_guard trigger is missing from schema/state.sql");
  }
  return match[0];
}

export function nodesVersionGuardExists(db: DatabaseSync): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'nodes_version_guard'")
    .get();
  return row !== undefined;
}

export function dropNodesVersionGuard(db: DatabaseSync): void {
  if (!nodesVersionGuardExists(db)) {
    throw new Error("nodes_version_guard is missing; refusing to rewrite history without the guard protocol");
  }
  db.exec("DROP TRIGGER nodes_version_guard");
}

export function restoreNodesVersionGuard(db: DatabaseSync): void {
  db.exec(readNodesVersionGuardSql());
}

export function assertNodesVersionGuardActive(db: DatabaseSync): void {
  if (!nodesVersionGuardExists(db)) {
    throw new Error("nodes_version_guard was not restored after the sanctioned purge rewrite");
  }
  const sample = db.prepare("SELECT id FROM nodes LIMIT 1").get();
  if (!sample) return;
  if (db.isTransaction) {
    throw new Error("nodes_version_guard probe must run outside the purge transaction");
  }
  const id = sqlText(sample["id"]);
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE nodes SET title = title || ? WHERE id = ?").run("!", id);
    db.exec("ROLLBACK");
    throw new Error("nodes_version_guard did not reject a version-stable meaning change");
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("node change requires version + 1")) return;
    throw error;
  }
}
