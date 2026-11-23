import type { PersistedNameKind, SafetyZone } from "./types.js";

const MIGRATION_PATH =
  /(^|\/)(migrations\/|prisma\/migrations\/).*\.sql$/i;

const CODE_PATH = /\.(tsx?|jsx?|mjs|cjs|py|go|rs|vue|svelte)$/i;

export function isHistoricalMigrationPath(filePath: string): boolean {
  return MIGRATION_PATH.test(filePath.replaceAll("\\", "/"));
}

export function defaultFileZone(filePath: string): SafetyZone {
  const rel = filePath.replaceAll("\\", "/");
  if (isHistoricalMigrationPath(rel)) return "immutable_migration";
  return "zone1_internal";
}

export function classifyLineHit(
  filePath: string,
  lineText: string,
  matchedVariant: string,
): { zone: SafetyZone; persistedKind?: PersistedNameKind } {
  const rel = filePath.replaceAll("\\", "/");
  if (isHistoricalMigrationPath(rel)) {
    return { zone: "immutable_migration" };
  }

  const trimmed = lineText.trim();

  if (/\bCREATE\s+TABLE\b/i.test(trimmed) && new RegExp(`\\b${escapeRegExp(matchedVariant)}\\b`, "i").test(trimmed)) {
    return { zone: "zone2_persisted", persistedKind: "sql_table" };
  }
  if (
    /\b@Column\b|\bREFERENCES\b|\bALTER\s+TABLE\b/i.test(trimmed) &&
    new RegExp(`\\b${escapeRegExp(matchedVariant)}\\b`, "i").test(trimmed)
  ) {
    return { zone: "zone2_persisted", persistedKind: "sql_column" };
  }
  if (/@map\s*\(\s*["'`]/.test(trimmed) && trimmed.includes(matchedVariant)) {
    return { zone: "zone2_persisted", persistedKind: "sql_column" };
  }

  if (/\.(json|yaml|yml)$/i.test(rel)) {
    const jsonKey = new RegExp(`["'\`]${escapeRegExp(matchedVariant)}[^"'\`]*["'\`]\\s*:`);
    const snakeInKey = /["'`][^"'`]*order_item[^"'`]*["'`]\s*:/.test(trimmed);
    if (jsonKey.test(trimmed) || snakeInKey) {
      return { zone: "zone2_persisted", persistedKind: "json_wire_key" };
    }
  }

  if (new RegExp(`\\b${escapeRegExp(matchedVariant.toUpperCase())}_`).test(trimmed) || /^\s*[A-Z][A-Z0-9_]*=/.test(trimmed)) {
    if (matchedVariant === matchedVariant.toUpperCase() || /MEAL_ORDER|ORDER_ITEM/.test(matchedVariant.toUpperCase())) {
      return { zone: "zone2_persisted", persistedKind: "env_var" };
    }
  }

  if (/localStorage\.(getItem|setItem|removeItem)\s*\(\s*['"`]/.test(trimmed) && trimmed.includes(matchedVariant)) {
    return { zone: "zone2_persisted", persistedKind: "local_storage_key" };
  }

  if (/router\.(push|replace)\s*\(\s*['"`]/.test(trimmed) && trimmed.includes(matchedVariant)) {
    return { zone: "zone2_persisted", persistedKind: "route_slug" };
  }

  if (/\.env/.test(rel) || trimmed.startsWith(`${matchedVariant}=`)) {
    return { zone: "zone2_persisted", persistedKind: "env_var" };
  }

  if (CODE_PATH.test(rel)) {
    return { zone: "zone1_internal" };
  }

  if (/\.sql$/i.test(rel)) {
    return { zone: "zone2_persisted", persistedKind: "sql_table" };
  }

  return { zone: "zone1_internal" };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}