import { parseCheckExpression, parseColumnType } from "./bounds.js";
import { SchemaMetadataError } from "./errors.js";
import type {
  ColumnSchema,
  LengthUnit,
  SchemaMetadata,
  SeedRecipe,
  TableSchema,
} from "./types.js";

export interface NormalizedColumn {
  readonly name: string;
  readonly rawType: string;
  readonly family: "int" | "real" | "text" | "bool" | "blob" | "timestamp";
  readonly nullable: boolean;
  readonly primaryKey: boolean;
  readonly unique: boolean;
  readonly lengthUnit: LengthUnit;
  readonly hint: string;
  readonly softDelete: boolean;
  readonly min?: number;
  readonly max?: number;
  readonly maxLength?: number;
  readonly references?: { readonly table: string; readonly column: string };
  readonly allowedValues?: readonly string[];
}

export interface NormalizedTable {
  readonly name: string;
  readonly columns: readonly NormalizedColumn[];
  readonly primaryKey: readonly string[];
  readonly uniqueGroups: readonly (readonly string[])[];
  readonly maxRows?: number;
}

export interface NormalizedSchema {
  readonly dialect: "sqlite" | "postgres";
  readonly tables: readonly NormalizedTable[];
  readonly tableByName: ReadonlyMap<string, NormalizedTable>;
}

export function normalizeSchema(schema: SchemaMetadata, recipe: SeedRecipe): NormalizedSchema {
  if (!Array.isArray(schema.tables) || schema.tables.length === 0) {
    throw new SchemaMetadataError("Schema must declare at least one table");
  }
  const tables = schema.tables.map((table) => normalizeTable(table, recipe));
  const tableByName = new Map(tables.map((table) => [table.name, table]));
  return {
    dialect: schema.dialect ?? "sqlite",
    tables,
    tableByName,
  };
}

function normalizeTable(table: TableSchema, recipe: SeedRecipe): NormalizedTable {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table.name)) {
    throw new SchemaMetadataError(`Unsafe table name "${table.name}"`);
  }
  if (table.columns.length === 0) {
    throw new SchemaMetadataError(`Table ${table.name} has no columns`);
  }
  const columns = table.columns.map((column) =>
    normalizeColumn(table.name, column, recipe, table.checks ?? []),
  );
  const primaryKey =
    table.primaryKey !== undefined && table.primaryKey.length > 0
      ? [...table.primaryKey]
      : columns.filter((column) => column.primaryKey).map((column) => column.name);
  if (primaryKey.length === 0) {
    throw new SchemaMetadataError(`Table ${table.name} needs a primary key`);
  }
  for (const key of primaryKey) {
    if (!columns.some((column) => column.name === key)) {
      throw new SchemaMetadataError(`Table ${table.name} primary key ${key} is not a column`);
    }
  }
  const uniqueGroups: string[][] = [[...primaryKey]];
  for (const column of columns) {
    if (column.unique && !primaryKey.includes(column.name)) uniqueGroups.push([column.name]);
  }
  for (const group of table.unique ?? []) {
    uniqueGroups.push([...group]);
  }
  return {
    name: table.name,
    columns,
    primaryKey,
    uniqueGroups,
    ...(table.maxRows !== undefined ? { maxRows: table.maxRows } : {}),
  };
}

function normalizeColumn(
  table: string,
  column: ColumnSchema,
  recipe: SeedRecipe,
  tableChecks: readonly string[],
): NormalizedColumn {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(column.name)) {
    throw new SchemaMetadataError(`Unsafe column name "${table}.${column.name}"`);
  }
  const parsed = parseColumnType(column.type);
  const ownCheck = column.check !== undefined ? parseCheckExpression(column.check, column.name) : {};
  const merged = [
    ownCheck,
    ...tableChecks.map((check) => parseCheckExpression(check, column.name)),
  ];
  let min = column.min;
  let max = column.max;
  let maxLength = column.maxLength ?? parsed.maxLength;
  let lengthUnit: LengthUnit = column.lengthUnit ?? "code_points";
  let allowed: readonly string[] | undefined;
  for (const fact of merged) {
    if (fact.min !== undefined) min = min === undefined ? fact.min : Math.max(min, fact.min);
    if (fact.max !== undefined) max = max === undefined ? fact.max : Math.min(max, fact.max);
    if (fact.maxLength !== undefined) {
      maxLength = maxLength === undefined ? fact.maxLength : Math.min(maxLength, fact.maxLength);
    }
    if (column.lengthUnit === undefined && fact.lengthUnit !== undefined) {
      lengthUnit = fact.lengthUnit;
    }
    if (fact.allowedValues !== undefined) allowed = fact.allowedValues;
  }
  const primaryKey = column.primaryKey === true;
  return {
    name: column.name,
    rawType: column.type,
    family: parsed.family,
    nullable: primaryKey ? false : column.nullable !== false,
    primaryKey,
    unique: column.unique === true || primaryKey,
    lengthUnit,
    hint: resolveHint(table, column, recipe),
    softDelete: isSoftDelete(column),
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
    ...(maxLength !== undefined ? { maxLength } : {}),
    ...(column.references ? { references: column.references } : {}),
    ...(allowed !== undefined ? { allowedValues: allowed } : {}),
  };
}

function resolveHint(table: string, column: ColumnSchema, recipe: SeedRecipe): string {
  const keyed = recipe.columnHints[`${table}.${column.name}`];
  if (keyed) return keyed;
  if (column.hint) return column.hint;
  const name = column.name.toLowerCase();
  if (name === "email" || name.endsWith("_email")) return "email";
  if (name.includes("minor") || name.endsWith("_cents") || name === "amount_cents") {
    return "money_minor_units";
  }
  if (name.endsWith("_at") || name.includes("timestamp")) return "timestamp_utc";
  if (name === "slug" || name.endsWith("_slug")) return "slug";
  if (name.includes("dish")) return "dish_name";
  if (name === "phone" || name.endsWith("_phone")) return "phone";
  if (name === "url" || name.endsWith("_url") || name === "website") return "url";
  if (name === "name" || name.endsWith("_name") || name === "title") return "name";
  if (name === "id" || column.primaryKey) return "id";
  if (column.references) return "fk";
  return parseColumnType(column.type).family;
}

function isSoftDelete(column: ColumnSchema): boolean {
  if (column.softDelete) return true;
  const name = column.name.toLowerCase();
  return name === "deleted_at" || name === "deletedat" || name === "is_deleted" || name === "isdeleted";
}
