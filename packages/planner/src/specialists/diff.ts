export interface DiffHunk {
  readonly filePath: string;
  readonly newStart: number;
  readonly newCount: number;
  readonly lines: readonly number[];
}

export interface ParsedDiff {
  readonly hunks: readonly DiffHunk[];
  readonly files: ReadonlyMap<string, ReadonlySet<number>>;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Index new-file line numbers that appear in unified-diff hunks.
 * A citation can block only when both ends of its range are in this set.
 */
export function parseUnifiedDiff(diff: string): ParsedDiff {
  const hunks: DiffHunk[] = [];
  const files = new Map<string, Set<number>>();
  let filePath: string | null = null;
  let newLine = 0;
  let inHunk = false;
  let current: { filePath: string; newStart: number; newCount: number; lines: number[] } | null = null;

  const finish = (): void => {
    if (!current) return;
    hunks.push(current);
    current = null;
  };

  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      finish();
      filePath = null;
      inHunk = false;
      continue;
    }
    if (line.startsWith("+++ ")) {
      const path = line.slice(4).trim();
      filePath = path === "/dev/null" ? null : path.replace(/^b\//, "");
      continue;
    }
    const header = HUNK_HEADER.exec(line);
    if (header) {
      finish();
      inHunk = filePath !== null;
      newLine = Number(header[3]);
      const count = header[4] === undefined ? 1 : Number(header[4]);
      current = filePath
        ? { filePath, newStart: newLine, newCount: count, lines: [] }
        : null;
      continue;
    }
    if (!inHunk || !filePath || !current) continue;
    if (line.startsWith("\\")) continue;
    const marker = line[0];
    if (marker === "+") {
      const set = files.get(filePath) ?? new Set<number>();
      set.add(newLine);
      files.set(filePath, set);
      current.lines.push(newLine);
      newLine += 1;
      continue;
    }
    if (marker === "-") continue;
    if (marker === " " || line === "") {
      const set = files.get(filePath) ?? new Set<number>();
      set.add(newLine);
      files.set(filePath, set);
      current.lines.push(newLine);
      newLine += 1;
    }
  }
  finish();
  return { hunks, files };
}

export function lineRangeInDiff(
  files: ReadonlyMap<string, ReadonlySet<number>>,
  filePath: string,
  start: number,
  end: number,
): boolean {
  if (!Number.isInteger(start) || !Number.isInteger(end) || end < start || start < 1) return false;
  const lines = files.get(filePath);
  if (!lines) return false;
  for (let line = start; line <= end; line += 1) {
    if (!lines.has(line)) return false;
  }
  return true;
}

const LOCATION = /^(.+):(\d+)(?:-(\d+))?$/;

export function parseLocation(location: string): { filePath: string; start: number; end: number } | null {
  const match = LOCATION.exec(location.trim());
  if (!match || !match[1] || !match[2]) return null;
  const start = Number(match[2]);
  const end = match[3] === undefined ? start : Number(match[3]);
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  return { filePath: match[1], start, end };
}
