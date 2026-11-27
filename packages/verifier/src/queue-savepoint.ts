import type { SqliteConnection } from "@ef-harness/db";

/**
 * The write queue already holds `BEGIN IMMEDIATE` and rejects transaction SQL.
 * Nested acceptance and hint-ladder transactions become savepoints on that writer.
 */
export function createSavepointGate(writer: SqliteConnection): (sql: string) => boolean {
  let depth = 0;
  return (sql: string): boolean => {
    const command = sqlCommand(sql);
    if (command === "BEGIN") {
      depth += 1;
      writer.exec(`SAVEPOINT vf_${String(depth)}`);
      return true;
    }
    if (command === "COMMIT" || command === "END") {
      writer.exec(`RELEASE vf_${String(depth)}`);
      depth -= 1;
      return true;
    }
    if (command === "ROLLBACK") {
      writer.exec(`ROLLBACK TO vf_${String(depth)}`);
      writer.exec(`RELEASE vf_${String(depth)}`);
      depth -= 1;
      return true;
    }
    return false;
  };
}

function sqlCommand(sql: string): string {
  const match = /^([A-Za-z]+)/.exec(sql.trim());
  return match?.[1]?.toUpperCase() ?? "";
}
