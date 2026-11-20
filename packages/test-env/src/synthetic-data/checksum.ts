import { canonicalJson, sha256Hex, type Canonical } from "./hash.js";
import type { DataRow, DataValue, GeneratedDataset, TableChecksum } from "./types.js";

export interface ChecksumTable {
  readonly name: string;
  readonly primaryKey?: readonly string[];
  readonly columns?: readonly string[];
  readonly rows: readonly DataRow[];
}

export function computeTableChecksums(
  input: GeneratedDataset | { readonly tables: readonly ChecksumTable[] },
): readonly TableChecksum[] {
  return input.tables.map((table) =>
    checksumTable(table.name, table.primaryKey ?? [], table.columns, table.rows),
  );
}

function checksumTable(
  name: string,
  primaryKey: readonly string[],
  declaredColumns: readonly string[] | undefined,
  rows: readonly DataRow[],
): TableChecksum {
  const ordered = [...rows].sort((left, right) => compareRows(left, right, primaryKey));
  const columns = declaredColumns !== undefined ? [...declaredColumns] : columnNames(ordered);
  const digests = columns.map((column) => {
    const lines = ordered.map((row) => canonValue(row[column] ?? null));
    return {
      column,
      sha256: sha256Hex(`${column}\n${lines.join("\n")}`),
    };
  });
  const tableSha256 = sha256Hex(
    canonicalJson({
      table: name,
      rowCount: ordered.length,
      columns: digests.map((digest) => `${digest.column}:${digest.sha256}`),
    }),
  );
  return {
    table: name,
    rowCount: ordered.length,
    columns: digests,
    tableSha256,
  };
}

function columnNames(rows: readonly DataRow[]): string[] {
  const names = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) names.add(key);
  }
  return [...names];
}

function compareRows(left: DataRow, right: DataRow, primaryKey: readonly string[]): number {
  const keys = primaryKey.length > 0 ? primaryKey : Object.keys(left);
  for (const key of keys) {
    const compared = compareValues(left[key] ?? null, right[key] ?? null);
    if (compared !== 0) return compared;
  }
  return 0;
}

function compareValues(left: DataValue, right: DataValue): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "boolean" && typeof right === "boolean") return Number(left) - Number(right);
  const lText = String(left);
  const rText = String(right);
  if (lText < rText) return -1;
  if (lText > rText) return 1;
  return 0;
}

function canonValue(value: DataValue): string {
  if (value === null) return "null";
  if (typeof value === "string") return `s:${value.normalize("NFC")}`;
  if (typeof value === "boolean") return `b:${value ? "1" : "0"}`;
  if (Object.is(value, -0)) return "n:0";
  return `n:${value}`;
}

export function valueToken(value: DataValue): string {
  return canonValue(value);
}

export function checksumCanonical(value: Canonical): string {
  return sha256Hex(canonicalJson(value));
}
