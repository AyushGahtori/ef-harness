import { readRowNumber, readRowStringOrNull, type SqlDatabase } from "./sql.js";

export function readRevisionToken(db: SqlDatabase): string {
  const meta = db.prepare(`SELECT value FROM meta WHERE key = 'last_rev'`).get();
  const rev = db.prepare(`SELECT coalesce(max(rev), 0) AS rev FROM change_sets`).get();
  const metaValue = meta ? readRowStringOrNull(meta, "value") : null;
  const maxRev = rev ? readRowNumber(rev, "rev") : 0;
  return `${metaValue ?? ""}:${maxRev}`;
}

export function currentRevision(db: SqlDatabase): number {
  const rev = db.prepare(`SELECT coalesce(max(rev), 0) AS rev FROM change_sets`).get();
  return rev ? readRowNumber(rev, "rev") : 0;
}
