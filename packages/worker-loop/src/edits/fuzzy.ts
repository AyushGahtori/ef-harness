import { logicalLines } from "./text.js";

export interface ClosestRegion {
  readonly startLine: number;
  readonly endLine: number;
  readonly snippet: string;
}

function diceCoefficient(left: string, right: string): number {
  if (left === right) return 1;
  if (left.length < 2 || right.length < 2) return 0;
  const counts = new Map<string, number>();
  for (let index = 0; index < left.length - 1; index += 1) {
    const gram = left.slice(index, index + 2);
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  let overlap = 0;
  const used = new Map<string, number>();
  for (let index = 0; index < right.length - 1; index += 1) {
    const gram = right.slice(index, index + 2);
    const seen = used.get(gram) ?? 0;
    const available = counts.get(gram) ?? 0;
    if (seen < available) {
      overlap += 1;
      used.set(gram, seen + 1);
    }
  }
  return (2 * overlap) / (left.length - 1 + (right.length - 1));
}

function lineSimilarity(fileLine: string, searchLine: string): number {
  const left = fileLine.trim();
  const right = searchLine.trim();
  if (left === right) return 1;
  if (left.length === 0 || right.length === 0) return 0;
  return diceCoefficient(left.slice(0, 200), right.slice(0, 200));
}

export function findClosestRegion(fileText: string, search: string): ClosestRegion {
  const fileLines = logicalLines(fileText);
  const searchLines = logicalLines(search);
  if (fileLines.length === 0) {
    return { startLine: 1, endLine: 1, snippet: "" };
  }
  const window = Math.max(1, Math.min(Math.max(searchLines.length, 1), fileLines.length));
  let bestScore = -1;
  let bestStart = 0;
  for (let index = 0; index <= fileLines.length - window; index += 1) {
    let score = 0;
    for (let line = 0; line < window; line += 1) {
      score += lineSimilarity(fileLines[index + line] ?? "", searchLines[line] ?? "");
    }
    if (score > bestScore) {
      bestScore = score;
      bestStart = index;
    }
  }
  const snippet = fileLines.slice(bestStart, bestStart + window).join("\n");
  return {
    startLine: bestStart + 1,
    endLine: bestStart + window,
    snippet,
  };
}
