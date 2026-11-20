import fs from "node:fs";
import { canonicalAssetAbsolute, type CanonicalAssetKey } from "@ef-harness/shared-contracts";
import { AuxiliaryDbError } from "./errors.js";

const SCHEMA_KEYS = {
  global: "globalSql",
  telemetry: "telemetrySql",
  codeIndex: "codeIndexSql",
} as const satisfies Record<string, CanonicalAssetKey>;

export type SchemaKind = keyof typeof SCHEMA_KEYS;

const cache = new Map<SchemaKind, string>();

export function loadCanonicalSchema(kind: SchemaKind): string {
  const cached = cache.get(kind);
  if (cached !== undefined) return cached;
  const filePath = canonicalAssetAbsolute(SCHEMA_KEYS[kind]);
  const sql = fs.readFileSync(filePath, "utf8");
  if (!sql.includes("CREATE TABLE")) {
    throw new AuxiliaryDbError("SCHEMA_EMPTY", `canonical schema ${SCHEMA_KEYS[kind]} has no tables`);
  }
  cache.set(kind, sql);
  return sql;
}

export function schemaTableNames(sql: string): readonly string[] {
  const names: string[] = [];
  const pattern = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)/gi;
  for (const match of sql.matchAll(pattern)) {
    const name = match[1];
    if (name !== undefined) names.push(name);
  }
  return names;
}
