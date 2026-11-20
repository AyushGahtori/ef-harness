/** Line diff used to scope escapes, skips, and secret scans to additions. */

export interface AddedLine {
  readonly line: number;
  readonly text: string;
}

export function diffAddedLines(before: string, after: string): AddedLine[] {
  const older = before.split(/\r?\n/);
  const newer = after.split(/\r?\n/);
  if (older.length * newer.length > 1_500_000) {
    const seen = new Map<string, number>();
    for (const line of older) {
      seen.set(line, (seen.get(line) ?? 0) + 1);
    }
    const added: AddedLine[] = [];
    newer.forEach((text, index) => {
      const count = seen.get(text) ?? 0;
      if (count > 0) {
        seen.set(text, count - 1);
        return;
      }
      added.push({ line: index + 1, text });
    });
    return added;
  }
  return addedFromLcs(older, newer);
}

function addedFromLcs(older: string[], newer: string[]): AddedLine[] {
  const height = older.length;
  const width = newer.length;
  const dp: number[][] = Array.from({ length: height + 1 }, () => Array<number>(width + 1).fill(0));
  for (let row = height - 1; row >= 0; row -= 1) {
    for (let col = width - 1; col >= 0; col -= 1) {
      const left = older[row];
      const right = newer[col];
      const downRight = dp[row + 1]?.[col + 1] ?? 0;
      const down = dp[row + 1]?.[col] ?? 0;
      const across = dp[row]?.[col + 1] ?? 0;
      const current = dp[row];
      if (!current) continue;
      current[col] = left !== undefined && right !== undefined && left === right
        ? downRight + 1
        : Math.max(down, across);
    }
  }
  const added: AddedLine[] = [];
  let row = 0;
  let col = 0;
  while (row < height && col < width) {
    if (older[row] === newer[col]) {
      row += 1;
      col += 1;
      continue;
    }
    const down = dp[row + 1]?.[col] ?? 0;
    const across = dp[row]?.[col + 1] ?? 0;
    if (down >= across) {
      row += 1;
    } else {
      added.push({ line: col + 1, text: newer[col] ?? "" });
      col += 1;
    }
  }
  while (col < width) {
    added.push({ line: col + 1, text: newer[col] ?? "" });
    col += 1;
  }
  return added;
}

export function deletionRatio(before: string, after: string): number {
  const older = before.split(/\r?\n/).filter((line) => line.length > 0);
  if (older.length === 0) return 0;
  const newer = new Set(after.split(/\r?\n/));
  let removed = 0;
  for (const line of older) {
    if (!newer.has(line)) removed += 1;
  }
  return removed / older.length;
}

export function unifiedAdditions(file: string, lines: readonly AddedLine[]): string {
  const hunks = lines.map((line) => {
    return `+++ b/${file}\n@@ -0,0 +${line.line},1 @@\n+${line.text}`;
  });
  return hunks.join("\n");
}
