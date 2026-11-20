import type { SqlValue } from "./driver.ts";

/** Same split as schema/schema-test.js so FTS triggers see camelCase and snake_case parts. */
export function efSearchText(value: SqlValue): string {
  if (!value) return "";
  const text = String(value);
  const extra = text.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_\-./:]+/g, " ");
  return `${text} ${extra}`;
}
