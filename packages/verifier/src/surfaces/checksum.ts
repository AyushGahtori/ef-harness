import { createHash } from "node:crypto";

export interface ChecksumTableInput {
  readonly primaryKey: string;
  readonly columns: readonly string[];
  readonly rows: readonly Record<string, unknown>[];
}

export interface TableChecksum {
  readonly rowCount: number;
  readonly columns: Readonly<Record<string, string>>;
}

function canonicalCell(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  return JSON.stringify(value);
}

function comparePrimaryKey(left: unknown, right: unknown): number {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return canonicalCell(left).localeCompare(canonicalCell(right));
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Local port of Task 052 `computeTableChecksums`.
 * Hashes each unchanged column in primary-key order so a dropped row, a NULL
 * turning into a value, or a truncated UTF-8 string changes the digest.
 */
export function computeTableChecksums(input: ChecksumTableInput): TableChecksum {
  const sorted = [...input.rows].sort((left, right) =>
    comparePrimaryKey(left[input.primaryKey], right[input.primaryKey]),
  );
  const columns: Record<string, string> = {};
  for (const column of input.columns) {
    const canonical = sorted.map((row) => canonicalCell(row[column])).join("\n");
    columns[column] = sha256Text(canonical);
  }
  return { rowCount: sorted.length, columns };
}

export function checksumsEqual(left: TableChecksum, right: TableChecksum, columns: readonly string[]): string[] {
  const problems: string[] = [];
  if (left.rowCount !== right.rowCount) {
    problems.push(`row count changed from ${left.rowCount} to ${right.rowCount}`);
  }
  for (const column of columns) {
    const before = left.columns[column];
    const after = right.columns[column];
    if (before === undefined || after === undefined || before !== after) {
      problems.push(`unchanged column ${column} checksum differs`);
    }
  }
  return problems;
}
