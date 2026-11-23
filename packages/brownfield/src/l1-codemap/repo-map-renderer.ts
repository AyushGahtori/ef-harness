import type { ExtractedSymbol } from "./types.js";

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function renderCompactRepoMap(
  rankedPaths: readonly { path: string; score: number }[],
  symbolLookup: (path: string) => readonly ExtractedSymbol[],
  maxTokens: number,
): string {
  const lines: string[] = [];
  for (const row of rankedPaths) {
    const exported = symbolLookup(row.path).filter((s) => s.exported);
    const chunk: string[] = [`${row.path} (rank ${row.score.toFixed(4)})`];
    for (const symbol of exported.slice(0, 12)) {
      const sig =
        symbol.signature ??
        `export ${symbol.kind} ${symbol.name}` +
          (symbol.kind === "function" ? "(...)" : "");
      chunk.push(`  ${sig}`);
    }
    const candidate = lines.length > 0 ? `${lines.join("\n")}\n${chunk.join("\n")}` : chunk.join("\n");
    if (estimateTokens(candidate) > maxTokens) break;
    lines.push(...chunk);
  }
  return lines.join("\n");
}