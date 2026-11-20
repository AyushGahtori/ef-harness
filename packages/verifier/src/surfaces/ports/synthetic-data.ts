import type { ColumnSpec } from "../schemas.js";

/**
 * Local port of Task 052 `generateMigrationPredecessorFixture`.
 * Builds the predecessor rows the migration verifier inserts before `up`.
 */

export const FIXTURE_UNICODE = "🍜 Ümlaut مرحبا";
export const FIXTURE_ORPHAN_ID = 999999;
export const FIXTURE_BOUNDARY_DATES = [
  "1970-01-01T00:00:00.000Z",
  "2026-03-29T00:59:59.000Z",
  "2026-10-25T00:30:00.000Z",
  "9999-12-31T23:59:59.000Z",
] as const;

export type FixtureCell = string | number | null;

export interface PredecessorFixture {
  readonly rows: readonly Record<string, FixtureCell>[];
  readonly profile: {
    readonly nulls: boolean;
    readonly unicode: boolean;
    readonly maxLengths: boolean;
    readonly duplicates: boolean;
    readonly boundaryDates: boolean;
    readonly orphanLooking: boolean;
  };
}

function primaryKey(columns: readonly ColumnSpec[]): ColumnSpec {
  const key = columns.find((column) => column.primaryKey);
  if (!key) throw new Error("predecessor fixture requires a primary key column");
  return key;
}

function blank(columns: readonly ColumnSpec[], id: number, seed: number): Record<string, FixtureCell> {
  const row: Record<string, FixtureCell> = {};
  for (const column of columns) {
    if (column.primaryKey) row[column.name] = id;
    else if (column.type === "integer") row[column.name] = seed;
    else if (column.type === "timestamp") row[column.name] = FIXTURE_BOUNDARY_DATES[0];
    else row[column.name] = `row-${id}`;
  }
  return row;
}

export function generateMigrationPredecessorFixture(input: {
  readonly columns: readonly ColumnSpec[];
  readonly seed: number;
}): PredecessorFixture {
  const columns = input.columns;
  const key = primaryKey(columns);
  const textColumns = columns.filter((column) => column.type === "text");
  const nullable = columns.filter((column) => column.nullable);
  const timestamps = columns.filter((column) => column.type === "timestamp");
  const orphanColumns = columns.filter((column) => column.type === "integer" && !column.primaryKey);
  const limited = textColumns.filter((column) => column.maxLength !== undefined);
  const duplicateColumn = textColumns.find((column) => !column.primaryKey) ?? textColumns[0];

  const rows: Record<string, FixtureCell>[] = [];
  const baseline = blank(columns, 1, input.seed);
  if (textColumns[0]) baseline[textColumns[0].name] = "Soup";
  rows.push(baseline);

  if (nullable.length > 0) {
    const row = blank(columns, 2, input.seed);
    for (const column of nullable) row[column.name] = null;
    if (textColumns[0] && !textColumns[0].nullable) row[textColumns[0].name] = "Nullable";
    rows.push(row);
  }

  if (textColumns.length > 0) {
    const row = blank(columns, rows.length + 1, input.seed);
    const target =
      textColumns.find((column) => (column.maxLength ?? FIXTURE_UNICODE.length) >= FIXTURE_UNICODE.length) ??
      textColumns[0];
    if (target) row[target.name] = FIXTURE_UNICODE;
    rows.push(row);
  }

  if (limited.length > 0) {
    for (const column of limited) {
      if (!column.maxLength) continue;
      const row = blank(columns, rows.length + 1, input.seed);
      row[column.name] = "M".repeat(column.maxLength);
      rows.push(row);
    }
  }

  if (duplicateColumn) {
    const left = blank(columns, rows.length + 1, input.seed);
    const right = blank(columns, rows.length + 2, input.seed);
    left[duplicateColumn.name] = "duplicate-note";
    right[duplicateColumn.name] = "duplicate-note";
    rows.push(left, right);
  }

  for (const instant of FIXTURE_BOUNDARY_DATES) {
    const row = blank(columns, rows.length + 1, input.seed);
    for (const column of timestamps) row[column.name] = instant;
    rows.push(row);
  }

  if (orphanColumns.length > 0) {
    const row = blank(columns, rows.length + 1, input.seed);
    for (const column of orphanColumns) row[column.name] = FIXTURE_ORPHAN_ID;
    rows.push(row);
  }

  const profile = profileOf(rows, columns, key.name);
  return { rows, profile };
}

function profileOf(
  rows: readonly Record<string, FixtureCell>[],
  columns: readonly ColumnSpec[],
  primary: string,
): PredecessorFixture["profile"] {
  const nullable = columns.filter((column) => column.nullable);
  const textColumns = columns.filter((column) => column.type === "text" && column.name !== primary);
  const limited = textColumns.filter((column) => column.maxLength !== undefined);
  const timestamps = columns.filter((column) => column.type === "timestamp");
  const orphans = columns.filter((column) => column.type === "integer" && !column.primaryKey);
  return {
    nulls: nullable.length === 0 || nullable.every((column) => rows.some((row) => row[column.name] === null)),
    unicode: textColumns.some((column) =>
      rows.some((row) => {
        const value = row[column.name];
        return typeof value === "string" && value.includes("🍜");
      }),
    ),
    maxLengths:
      limited.length === 0 ||
      limited.every((column) =>
        rows.some((row) => {
          const value = row[column.name];
          return typeof value === "string" && value.length === column.maxLength;
        }),
      ),
    duplicates: textColumns.some((column) => {
      const values = rows.map((row) => row[column.name]).filter((value) => value !== null);
      return new Set(values).size < values.length;
    }),
    boundaryDates:
      timestamps.length === 0 ||
      FIXTURE_BOUNDARY_DATES.every((instant) =>
        rows.some((row) => timestamps.some((column) => row[column.name] === instant)),
      ),
    orphanLooking:
      orphans.length === 0 || orphans.some((column) => rows.some((row) => row[column.name] === FIXTURE_ORPHAN_ID)),
  };
}
