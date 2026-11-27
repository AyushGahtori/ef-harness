import { splitSearchText } from "@ef-harness/shared-contracts";
import type { SqlValue } from "./types.js";

/** Canonical `ef_search_text` splitter from `@ef-harness/shared-contracts`. */
export function efSearchText(value: SqlValue): string {
  return splitSearchText(value);
}
