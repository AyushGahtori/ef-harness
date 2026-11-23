import path from "node:path";
import { fileURLToPath } from "node:url";

const benchmarksRoot = path.dirname(fileURLToPath(import.meta.url));

export function fixtureAbsolutePath(relativePath: string): string {
  const normalized = relativePath.replaceAll("\\", "/");
  return path.join(benchmarksRoot, "fixtures", normalized);
}

export function benchmarksModuleRoot(): string {
  return benchmarksRoot;
}