import { openNodeSqliteConnection } from "./connection.js";
import { tableExists } from "./sql.js";
import { REPAIR_OPTIONS } from "./types.js";
import type { GlobalBrokerDb, ProjectStatus, RepairOption, SqliteConnection } from "./types.js";

export interface NeedsRepairProject {
  readonly id: string;
  readonly path: string;
  readonly status: "needs_repair";
  readonly options: typeof REPAIR_OPTIONS;
}

export function markProjectNeedsRepair(globalDb: GlobalBrokerDb, projectId: string): {
  readonly projectId: string;
  readonly status: "needs_repair";
  readonly options: readonly RepairOption[];
} {
  globalDb.setProjectStatus(projectId, "needs_repair");
  return { projectId, status: "needs_repair", options: REPAIR_OPTIONS };
}

export function connectGlobalBrokerDb(globalDbPath: string): GlobalBrokerDb {
  return {
    setProjectStatus(projectId: string, status: ProjectStatus) {
      const conn = openNodeSqliteConnection(globalDbPath, { readOnly: false, targetDb: "global" });
      try {
        const result = conn.prepare("UPDATE projects SET status = ? WHERE id = ?").run(status, projectId);
        if (result.changes !== 1) {
          throw new Error(`Project "${projectId}" was not found in global.db.projects`);
        }
      } finally {
        conn.close();
      }
    },
    registerBackupCasPins(pin) {
      if (pin.hashes.length === 0) return;
      const conn = openNodeSqliteConnection(globalDbPath, { readOnly: false, targetDb: "global" });
      try {
        const insert = conn.prepare(
          "INSERT OR IGNORE INTO cas_pins(hash, holder_kind, holder_id, pinned_at) VALUES(?, 'backup', ?, ?)",
        );
        conn.exec("BEGIN IMMEDIATE");
        try {
          for (const hash of pin.hashes) {
            insert.run(hash, pin.backupId, pin.pinnedAt);
          }
          conn.exec("COMMIT");
        } catch (error) {
          try {
            conn.exec("ROLLBACK");
          } catch (rollbackError) {
            throw new Error(
              `cas_pins insert failed (${error instanceof Error ? error.message : String(error)}); rollback failed (${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)})`,
            );
          }
          throw error;
        }
      } finally {
        conn.close();
      }
    },
  };
}

export function listNeedsRepairProjects(globalDbPath: string): NeedsRepairProject[] {
  const conn = openNodeSqliteConnection(globalDbPath, { readOnly: true, targetDb: "global" });
  try {
    const rows = conn
      .prepare("SELECT id, path, status FROM projects WHERE status = 'needs_repair' ORDER BY id")
      .all();
    const projects: NeedsRepairProject[] = [];
    for (const row of rows) {
      if (typeof row.id !== "string" || typeof row.path !== "string") continue;
      projects.push({
        id: row.id,
        path: row.path,
        status: "needs_repair",
        options: REPAIR_OPTIONS,
      });
    }
    return projects;
  } finally {
    conn.close();
  }
}

export function readProjectStatus(globalDbPath: string, projectId: string): string | null {
  const conn = openNodeSqliteConnection(globalDbPath, { readOnly: true, targetDb: "global" });
  try {
    const row = conn.prepare("SELECT status FROM projects WHERE id = ?").get(projectId);
    return typeof row?.status === "string" ? row.status : null;
  } finally {
    conn.close();
  }
}

export function readArtifactHashes(conn: SqliteConnection): string[] {
  if (!tableExists(conn, "artifacts")) return [];
  const rows = conn.prepare("SELECT DISTINCT hash AS hash FROM artifacts WHERE hash IS NOT NULL AND hash <> ''").all();
  const hashes: string[] = [];
  for (const row of rows) {
    if (typeof row.hash === "string" && row.hash.length > 0) hashes.push(row.hash);
  }
  return hashes;
}
