import type { CodeMapQueryPort } from "./ports.js";
import type { ModuleCardWriterV1Output } from "./types.js";

export function repairHallucinatedExports(
  commitSha: string,
  filePath: string,
  card: ModuleCardWriterV1Output,
  codeMap: CodeMapQueryPort,
): ModuleCardWriterV1Output {
  const symbols = codeMap.symbolsForPath(commitSha, filePath);
  const exported = new Set(symbols.filter((s) => s.exported).map((s) => s.name));
  const key_exports = card.key_exports.filter((item) => exported.has(item.name));
  return { ...card, key_exports };
}