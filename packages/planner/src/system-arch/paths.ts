import path from "node:path";
import { fileURLToPath } from "node:url";

/** Repo root from either `src/system-arch` or the emitted `dist/system-arch` tree. */
export function repositoryRoot(moduleUrl: string = import.meta.url): string {
  return path.resolve(path.dirname(fileURLToPath(moduleUrl)), "..", "..", "..", "..");
}

export function stateSchemaPath(moduleUrl: string = import.meta.url): string {
  return path.join(repositoryRoot(moduleUrl), "schema", "state.sql");
}
