import fs from "node:fs";
import { canonicalAssetAbsolute } from "@ef-harness/shared-contracts";

export interface CanonicalQueries {
  readonly archiveTurnLog: string;
  readonly purgeArchivedTurnLog: string;
  readonly byName: Readonly<Record<string, string>>;
}

let cached: CanonicalQueries | null = null;

/**
 * Load named statements from schema/queries.sql using the same split as schema/schema-test.js.
 * archive_turn_log and purge_archived_turn_log are executed verbatim.
 */
export function loadCanonicalQueries(): CanonicalQueries {
  if (cached) return cached;
  const text = fs.readFileSync(canonicalAssetAbsolute("queriesSql"), "utf8");
  const byName: Record<string, string> = {};
  for (const block of text.split(/^-- name: /m).slice(1)) {
    const [nameLine, ...rest] = block.split("\n");
    const name = (nameLine ?? "").trim();
    if (!name) continue;
    const sql = rest
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .trim()
      .replace(/;\s*$/, "");
    byName[name] = sql;
  }
  const archiveTurnLog = byName.archive_turn_log;
  const purgeArchivedTurnLog = byName.purge_archived_turn_log;
  if (!archiveTurnLog || !archiveTurnLog.includes("HAVING count(*) > 0")) {
    throw new Error("schema/queries.sql is missing canonical archive_turn_log.");
  }
  if (
    !purgeArchivedTurnLog ||
    !purgeArchivedTurnLog.includes("NOT IN ('running','submitted','parked')")
  ) {
    throw new Error("schema/queries.sql is missing canonical purge_archived_turn_log.");
  }
  cached = { archiveTurnLog, purgeArchivedTurnLog, byName };
  return cached;
}
