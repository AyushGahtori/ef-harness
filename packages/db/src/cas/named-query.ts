import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Same named-query split as schema/schema-test.js. Comments and the trailing semicolon are removed. */
export function loadNamedQuery(sqlText: string, name: string): string {
  for (const block of sqlText.split(/^-- name: /m).slice(1)) {
    const [rawName, ...rest] = block.split("\n");
    if (rawName?.trim() !== name) continue;
    const sql = rest
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .trim()
      .replace(/;\s*$/, "");
    if (sql.length === 0) {
      throw new Error(`Named query ${name} is empty`);
    }
    return sql;
  }
  throw new Error(`Named query ${name} was not found`);
}

export function repositorySchemaFile(moduleUrl: string, fileName: string): string {
  return fileURLToPath(new URL(`../../../../schema/${fileName}`, moduleUrl));
}

/** The GC candidate list. Callers must not substitute a hand-written copy. */
export function globalCasGcCandidatesSql(queriesSqlPath?: string): string {
  const filePath = queriesSqlPath ?? repositorySchemaFile(import.meta.url, "queries.sql");
  const sql = loadNamedQuery(readFileSync(filePath, "utf8"), "global_cas_gc_candidates");
  if (
    !sql.includes(":grace_cutoff") ||
    !sql.includes("NOT EXISTS") ||
    !sql.includes("cas_pins") ||
    !sql.includes("LIMIT 1000")
  ) {
    throw new Error("global_cas_gc_candidates no longer has its canonical shape");
  }
  return sql;
}
