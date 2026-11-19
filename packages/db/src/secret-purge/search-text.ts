/** Mirrors schema/schema-test.js `splitWords` for the `ef_search_text` UDF. */
export function splitSearchText(value: string): string {
  if (!value) return "";
  const extra = value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_\-./:]+/g, " ");
  return `${value} ${extra}`;
}
