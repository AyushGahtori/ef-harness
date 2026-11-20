import path from "node:path";
import { fileURLToPath } from "node:url";

export function repositoryRoot(moduleUrl: string = import.meta.url): string {
  return path.resolve(path.dirname(fileURLToPath(moduleUrl)), "..", "..", "..", "..");
}

export function rulesSeamsDir(moduleUrl: string = import.meta.url): string {
  return path.join(repositoryRoot(moduleUrl), "corpus", "rules-seams");
}
