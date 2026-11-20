import type { SchemaMetadata, TableSchema } from "../../src/synthetic-data/index.js";

export function createTableSql(table: TableSchema): string {
  const columns = table.columns.map((column) => {
    const parts = [`"${column.name}" ${column.type}`];
    if (column.primaryKey) parts.push("PRIMARY KEY");
    else if (column.nullable === false) parts.push("NOT NULL");
    if (column.unique) parts.push("UNIQUE");
    if (column.references) {
      parts.push(`REFERENCES "${column.references.table}" ("${column.references.column}")`);
    }
    if (column.check) parts.push(`CHECK (${column.check})`);
    return parts.join(" ");
  });
  const groups = (table.unique ?? []).map(
    (group) => `UNIQUE (${group.map((column) => `"${column}"`).join(", ")})`,
  );
  return `CREATE TABLE "${table.name}" (${[...columns, ...groups].join(", ")});`;
}

export function migrationsFor(schema: SchemaMetadata): string[] {
  return schema.tables.map((table) => createTableSql(table));
}

export const demoSchema: SchemaMetadata = {
  dialect: "sqlite",
  tables: [
    {
      name: "users",
      columns: [
        { name: "id", type: "integer", primaryKey: true, nullable: false },
        { name: "email", type: "text", nullable: false, unique: true, hint: "email" },
        {
          name: "name",
          type: "varchar(32)",
          nullable: false,
          hint: "name",
          maxLength: 32,
          lengthUnit: "code_points",
        },
        { name: "city", type: "text", nullable: false },
        {
          name: "badge",
          type: "varchar(8)",
          nullable: false,
          maxLength: 8,
          lengthUnit: "utf8_bytes",
        },
        {
          name: "units",
          type: "varchar(4)",
          nullable: false,
          maxLength: 4,
          lengthUnit: "utf16_code_units",
        },
        { name: "deleted_at", type: "text", nullable: true, softDelete: true },
      ],
    },
    {
      name: "orders",
      columns: [
        { name: "id", type: "integer", primaryKey: true, nullable: false },
        {
          name: "user_id",
          type: "integer",
          nullable: true,
          references: { table: "users", column: "id" },
        },
        {
          name: "quantity",
          type: "integer",
          nullable: false,
          check: "quantity BETWEEN 1 AND 20",
        },
        { name: "dish", type: "text", nullable: false, hint: "dish_name" },
        { name: "happened_at", type: "text", nullable: false, hint: "timestamp_utc" },
        { name: "note", type: "text", nullable: true },
      ],
    },
  ],
};

export const performanceSchema: SchemaMetadata = {
  dialect: "sqlite",
  tables: [
    {
      name: "users",
      columns: [
        { name: "id", type: "integer", primaryKey: true, nullable: false },
        { name: "email", type: "text", nullable: false, unique: true, hint: "email" },
        { name: "name", type: "text", nullable: false, hint: "name" },
      ],
    },
    {
      name: "orders",
      columns: [
        { name: "id", type: "integer", primaryKey: true, nullable: false },
        {
          name: "user_id",
          type: "integer",
          nullable: true,
          references: { table: "users", column: "id" },
        },
        {
          name: "quantity",
          type: "integer",
          nullable: false,
          check: "quantity BETWEEN 1 AND 20",
        },
      ],
    },
  ],
};

export const categorySchema: SchemaMetadata = {
  dialect: "sqlite",
  tables: [
    {
      name: "categories",
      columns: [
        { name: "id", type: "integer", primaryKey: true, nullable: false },
        {
          name: "parent_id",
          type: "integer",
          nullable: true,
          references: { table: "categories", column: "id" },
        },
        { name: "name", type: "text", nullable: false, hint: "name" },
      ],
    },
  ],
};

export const cycleSchema: SchemaMetadata = {
  dialect: "sqlite",
  tables: [
    {
      name: "users",
      columns: [
        { name: "id", type: "integer", primaryKey: true, nullable: false },
        { name: "email", type: "text", nullable: false, unique: true, hint: "email" },
        {
          name: "primary_team_id",
          type: "integer",
          nullable: true,
          references: { table: "teams", column: "id" },
        },
      ],
    },
    {
      name: "teams",
      columns: [
        { name: "id", type: "integer", primaryKey: true, nullable: false },
        { name: "name", type: "text", nullable: false, hint: "name" },
        {
          name: "owner_id",
          type: "integer",
          nullable: true,
          references: { table: "users", column: "id" },
        },
      ],
    },
  ],
};

export const lockedCycleSchema: SchemaMetadata = {
  dialect: "sqlite",
  tables: [
    {
      name: "users",
      columns: [
        { name: "id", type: "integer", primaryKey: true, nullable: false },
        {
          name: "primary_team_id",
          type: "integer",
          nullable: false,
          references: { table: "teams", column: "id" },
        },
      ],
    },
    {
      name: "teams",
      columns: [
        { name: "id", type: "integer", primaryKey: true, nullable: false },
        {
          name: "owner_id",
          type: "integer",
          nullable: false,
          references: { table: "users", column: "id" },
        },
      ],
    },
  ],
};

export function recipe(seed = 42) {
  return {
    seed,
    locale: "en",
    profile: "functional" as const,
    vocabularies: { dish_name: ["Ramen", "Salad", "Soup"] },
  };
}
