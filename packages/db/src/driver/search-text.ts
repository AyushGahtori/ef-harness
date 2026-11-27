import { splitSearchText } from "@ef-harness/shared-contracts";

export { splitSearchText };

export interface SearchTextDriverConnection {
  registerFunction(
    name: string,
    fn: (...args: readonly unknown[]) => unknown,
    options?: { deterministic?: boolean },
  ): void;
}

export interface SearchTextNativeDatabase {
  function(
    name: string,
    options: { deterministic?: boolean },
    fn: (...args: readonly unknown[]) => unknown,
  ): void;
}

export type SearchTextTarget = SearchTextDriverConnection | SearchTextNativeDatabase;

/**
 * Registers the deterministic `ef_search_text` SQLite UDF backed directly by
 * `@ef-harness/shared-contracts`'s canonical `splitSearchText`.
 */
export function registerEfSearchText(db: SearchTextTarget): void {
  const udf = (value: unknown): string => splitSearchText(value);
  if ("registerFunction" in db && typeof db.registerFunction === "function") {
    db.registerFunction("ef_search_text", udf, { deterministic: true });
    return;
  }
  if ("function" in db && typeof db.function === "function") {
    db.function("ef_search_text", { deterministic: true }, udf);
    return;
  }
  throw new TypeError("Target database does not expose registerFunction() or function().");
}
