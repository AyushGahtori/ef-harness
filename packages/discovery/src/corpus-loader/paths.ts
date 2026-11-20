import path from "node:path";
import { fileURLToPath } from "node:url";

export function repositoryCorpusRoot(moduleUrl: string = import.meta.url): string {
  return path.resolve(path.dirname(fileURLToPath(moduleUrl)), "..", "..", "..", "..", "corpus");
}
