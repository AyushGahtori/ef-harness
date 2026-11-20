import { SchemaMetadataError } from "./errors.js";
import type {
  BulkSql,
  DataRow,
  DataValue,
  LoadPlan,
  PostgresCopy,
  SqlBatch,
} from "./types.js";

export function quoteIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new SchemaMetadataError(`Unsafe identifier "${name}"`);
  }
  return `"${name}"`;
}

export function emitBulkSql(plan: LoadPlan): BulkSql {
  const sqlite: SqlBatch[] = [];
  const postgresInserts: SqlBatch[] = [];
  const postgresCopy: PostgresCopy[] = [];
  for (const insert of plan.inserts) {
    if (insert.rows.length === 0) continue;
    sqlite.push(...batchedInserts("sqlite", insert.table, insert.columns, insert.rows));
    postgresInserts.push(...batchedInserts("postgres", insert.table, insert.columns, insert.rows));
    postgresCopy.push(copyStatement(insert.table, insert.columns, insert.rows));
  }
  for (const update of plan.updates) {
    const batch = updateStatement(update.table, update.set, update.where);
    sqlite.push(batch);
    postgresInserts.push(batch);
  }
  return { sqlite, postgresInserts, postgresCopy };
}

export function batchedInserts(
  _dialect: "sqlite" | "postgres",
  table: string,
  columns: readonly string[],
  rows: readonly DataRow[],
): SqlBatch[] {
  const width = Math.max(1, columns.length);
  const batchSize = Math.max(1, Math.floor(500 / width));
  const batches: SqlBatch[] = [];
  const columnSql = columns.map((column) => quoteIdent(column)).join(", ");
  for (let start = 0; start < rows.length; start += batchSize) {
    const slice = rows.slice(start, start + batchSize);
    const tuples = slice.map(() => `(${columns.map(() => "?").join(", ")})`).join(", ");
    const params: DataValue[] = [];
    for (const row of slice) {
      for (const column of columns) params.push(row[column] ?? null);
    }
    batches.push({
      sql: `INSERT INTO ${quoteIdent(table)} (${columnSql}) VALUES ${tuples}`,
      params,
    });
  }
  return batches;
}

export function copyStatement(
  table: string,
  columns: readonly string[],
  rows: readonly DataRow[],
): PostgresCopy {
  const columnSql = columns.map((column) => quoteIdent(column)).join(", ");
  const stdin = rows
    .map((row) => columns.map((column) => copyField(row[column] ?? null)).join("\t"))
    .join("\n");
  return {
    sql: `COPY ${quoteIdent(table)} (${columnSql}) FROM STDIN WITH (FORMAT text, NULL '\\N')`,
    stdin: stdin.length > 0 ? `${stdin}\n` : "",
  };
}

export function updateStatement(table: string, set: DataRow, where: DataRow): SqlBatch {
  const setColumns = Object.keys(set);
  const whereColumns = Object.keys(where);
  const params: DataValue[] = [];
  for (const column of setColumns) params.push(set[column] ?? null);
  for (const column of whereColumns) params.push(where[column] ?? null);
  return {
    sql: `UPDATE ${quoteIdent(table)} SET ${setColumns
      .map((column) => `${quoteIdent(column)} = ?`)
      .join(", ")} WHERE ${whereColumns.map((column) => `${quoteIdent(column)} = ?`).join(" AND ")}`,
    params,
  };
}

export function copyField(value: DataValue): string {
  if (value === null) return "\\N";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Object.is(value, -0) ? "0" : String(value);
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\t", "\\t")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r");
}

export function parseCopyField(field: string): DataValue {
  if (field === "\\N") return null;
  if (field === "true") return true;
  if (field === "false") return false;
  const unescaped = field
    .replaceAll("\\r", "\r")
    .replaceAll("\\n", "\n")
    .replaceAll("\\t", "\t")
    .replaceAll("\\\\", "\\");
  if (/^-?\d+$/.test(unescaped)) return Number(unescaped);
  return unescaped;
}

export function sqlParam(value: DataValue): null | number | string {
  if (value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number" && Object.is(value, -0)) return 0;
  return value;
}
