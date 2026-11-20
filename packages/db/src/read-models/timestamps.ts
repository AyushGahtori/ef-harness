import type { ReadModelConnection } from "./sql.js";
import { integer, text } from "./values.js";

/**
 * `requirement_status_recompute` orders only by `recorded_at DESC`.
 * Rows that share a millisecond are rewritten so timestamps are strictly
 * increasing within a check. Ties break by attempt id, then check_version,
 * and the last row in that order becomes the newest result.
 */
export function ensureMonotonicCheckTimestamps(connection: ReadModelConnection): number {
  const rows = connection
    .prepare(
      `SELECT check_id, attempt, check_version, recorded_at
         FROM check_results
        ORDER BY check_id, recorded_at, attempt, check_version`,
    )
    .all();
  const update = connection.prepare(
    `UPDATE check_results
        SET recorded_at = ?
      WHERE check_id = ? AND attempt = ? AND check_version = ?`,
  );
  let adjusted = 0;
  let currentCheck = "";
  let lastAt = -1;
  for (const row of rows) {
    const checkId = text(row.check_id, "check_id");
    const attempt = text(row.attempt, "attempt");
    const checkVersion = integer(row.check_version, "check_version");
    const recordedAt = integer(row.recorded_at, "recorded_at");
    if (checkId !== currentCheck) {
      currentCheck = checkId;
      lastAt = recordedAt;
      continue;
    }
    if (recordedAt <= lastAt) {
      lastAt += 1;
      update.run([lastAt, checkId, attempt, checkVersion]);
      adjusted += 1;
    } else {
      lastAt = recordedAt;
    }
  }
  return adjusted;
}
