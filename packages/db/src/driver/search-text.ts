import * as sharedContracts from "@ef-harness/shared-contracts";

/**
 * Exact `splitWords` from schema/schema-test.js.
 * Task 007's `splitSearchText` formalizes this and is preferred when the
 * shared-contracts barrel exports it.
 */
export function splitSearchTextFallback(value: unknown): string {
  if (!value) return "";
  const text = String(value);
  const extra = text.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_\-./:]+/g, " ");
  return `${text} ${extra}`;
}

export function resolveSplitSearchText(): (value: unknown) => string {
  const exported = Reflect.get(sharedContracts, "splitSearchText") as unknown;
  if (typeof exported !== "function") return splitSearchTextFallback;
  return (value: unknown) => {
    const result = (exported as (input: unknown) => unknown)(value);
    return typeof result === "string" ? result : splitSearchTextFallback(value);
  };
}
