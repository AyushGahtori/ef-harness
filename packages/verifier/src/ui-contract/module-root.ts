import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Worktree or repo root that owns the frozen root `package.json`. */
export function repositoryRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
}

export function requireFromRepository<T>(packageName: string): T {
  const require = createRequire(path.join(repositoryRoot(), "package.json"));
  return require(packageName) as T;
}
