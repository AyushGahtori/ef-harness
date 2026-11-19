import type { SqlValue } from "./types.js";

/**
 * Same splitter the schema registers as `ef_search_text`:
 * keep the original text and add camelCase / snake_case / kebab-case breaks.
 */
export function efSearchText(value: SqlValue): string {
  if (value === null) return "";
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") return "";
  const text = String(value);
  if (text.length === 0) return "";
  const extra = text.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_\-./:]+/g, " ");
  return `${text} ${extra}`;
}
