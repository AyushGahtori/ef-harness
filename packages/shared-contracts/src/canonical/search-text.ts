/**
 * Canonical `ef_search_text` splitter.
 * Mirrors schema/schema-test.js `splitWords` and also splits acronym boundaries
 * (`XMLHttpRequest` → `XML Http Request`, `HTTPServer` → `HTTP Server`).
 * The original text is preserved as the first token span so FTS still sees it.
 */
export function splitSearchText(value: unknown): string {
  if (!value) return "";
  const original = typeof value === "string" ? value : String(value);
  const extra = original
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-./:]+/g, " ");
  return `${original} ${extra}`;
}
