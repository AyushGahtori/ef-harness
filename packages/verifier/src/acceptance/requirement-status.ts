import type { SqlStatement } from "./sql.js";
import { readRowString, readRowStringOrNull, type SqlDatabase } from "./sql.js";

export function syncRequirementStatusInTx(
  db: SqlDatabase,
  recompute: SqlStatement,
  rev: number,
): number {
  const rows = recompute.all();
  const upsert = db.prepare(
    `INSERT INTO requirement_status(requirement, feature, status, updated_rev)
     VALUES (:requirement, :feature, :status, :rev)
     ON CONFLICT(requirement) DO UPDATE SET
       feature = excluded.feature,
       status = excluded.status,
       updated_rev = excluded.updated_rev`,
  );
  for (const row of rows) {
    upsert.run({
      requirement: readRowString(row, "requirement"),
      feature: readRowStringOrNull(row, "feature"),
      status: readRowString(row, "status"),
      rev,
    });
  }
  return rows.length;
}
