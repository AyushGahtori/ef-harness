import type { QueryCatalog } from "./query-catalog.js";
import type { CanonicalReadModelQuery, TraceabilityGaps } from "./types.js";
import { compareText, text } from "./values.js";

export function readTraceabilityGaps(catalog: QueryCatalog): TraceabilityGaps {
  return {
    requirementsWithoutTask: column(catalog, "requirements_without_task", "id"),
    requirementsWithoutCheck: column(catalog, "requirements_without_check", "id"),
    tasksWithoutRequirement: column(catalog, "tasks_without_requirement", "task"),
  };
}

function column(
  catalog: QueryCatalog,
  name: CanonicalReadModelQuery,
  key: string,
): string[] {
  return catalog
    .all(name)
    .map((row) => text(row[key], key))
    .sort(compareText);
}
