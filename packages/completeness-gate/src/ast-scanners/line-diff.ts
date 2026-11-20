import { splitLines } from "./paths.js";

export function countLineDiff(
  previous: string,
  next: string,
): { readonly additions: number; readonly deletions: number } {
  const before = splitLines(previous);
  const after = splitLines(next);
  if (before.length === 0 && after.length === 0) {
    return { additions: 0, deletions: 0 };
  }
  if (before.length * after.length > 1_500_000) {
    return multisetDiff(before, after);
  }
  const shared = longestCommonSubsequence(before, after);
  return {
    deletions: before.length - shared,
    additions: after.length - shared,
  };
}

function multisetDiff(
  before: readonly string[],
  after: readonly string[],
): { readonly additions: number; readonly deletions: number } {
  const counts = new Map<string, number>();
  for (const line of before) counts.set(line, (counts.get(line) ?? 0) + 1);
  let additions = 0;
  for (const line of after) {
    const remaining = counts.get(line) ?? 0;
    if (remaining > 0) counts.set(line, remaining - 1);
    else additions += 1;
  }
  let deletions = 0;
  for (const remaining of counts.values()) deletions += remaining;
  return { additions, deletions };
}

function longestCommonSubsequence(before: readonly string[], after: readonly string[]): number {
  const height = before.length;
  const width = after.length;
  const row = new Array<number>(width + 1).fill(0);
  for (let y = 1; y <= height; y += 1) {
    let diagonal = 0;
    const leftLine = before[y - 1];
    for (let x = 1; x <= width; x += 1) {
      const above = row[x] ?? 0;
      const currentDiagonal = diagonal;
      diagonal = above;
      if (leftLine === after[x - 1]) row[x] = currentDiagonal + 1;
      else row[x] = Math.max(above, row[x - 1] ?? 0);
    }
  }
  return row[width] ?? 0;
}
