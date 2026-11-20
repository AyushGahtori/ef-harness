/** Line-oriented unified diff. Short node sections only; this is an audit record, not a merge tool. */
export function unifiedDiff(baseText: string, nextText: string, label: string): string {
  const base = baseText.replaceAll("\r\n", "\n").split("\n");
  const next = nextText.replaceAll("\r\n", "\n").split("\n");
  if (base.join("\n") === next.join("\n")) {
    return `--- ${label}\n+++ ${label}\n`;
  }
  const hunks = diffLines(base, next);
  const body = hunks.length > 0 ? hunks.join("\n") : fullReplace(base, next);
  return `--- base/${label}\n+++ markdown/${label}\n${body}\n`;
}

export function nodeAuditText(input: {
  readonly title: string;
  readonly prose: string;
  readonly fieldsJson: string;
}): string {
  return [`title: ${input.title}`, "prose:", input.prose, "fields:", input.fieldsJson].join("\n");
}

function fullReplace(base: readonly string[], next: readonly string[]): string {
  const lines = ["@@"];
  for (const line of base) lines.push(`-${line}`);
  for (const line of next) lines.push(`+${line}`);
  return lines.join("\n");
}

function diffLines(base: readonly string[], next: readonly string[]): string[] {
  if (base.length * next.length > 40_000) return [];
  const lcs = longestCommon(base, next);
  const lines: string[] = ["@@"];
  let indexB = 0;
  let indexN = 0;
  for (const common of lcs) {
    while (indexB < base.length && base[indexB] !== common) {
      lines.push(`-${base[indexB] ?? ""}`);
      indexB += 1;
    }
    while (indexN < next.length && next[indexN] !== common) {
      lines.push(`+${next[indexN] ?? ""}`);
      indexN += 1;
    }
    if (indexB < base.length) indexB += 1;
    if (indexN < next.length) indexN += 1;
  }
  while (indexB < base.length) {
    lines.push(`-${base[indexB] ?? ""}`);
    indexB += 1;
  }
  while (indexN < next.length) {
    lines.push(`+${next[indexN] ?? ""}`);
    indexN += 1;
  }
  return lines;
}

function longestCommon(base: readonly string[], next: readonly string[]): string[] {
  const rows = base.length + 1;
  const cols = next.length + 1;
  const scores: number[] = new Array(rows * cols).fill(0);
  const at = (row: number, col: number) => row * cols + col;
  for (let row = base.length - 1; row >= 0; row -= 1) {
    for (let col = next.length - 1; col >= 0; col -= 1) {
      if (base[row] === next[col]) scores[at(row, col)] = (scores[at(row + 1, col + 1)] ?? 0) + 1;
      else scores[at(row, col)] = Math.max(scores[at(row + 1, col)] ?? 0, scores[at(row, col + 1)] ?? 0);
    }
  }
  const out: string[] = [];
  let row = 0;
  let col = 0;
  while (row < base.length && col < next.length) {
    if (base[row] === next[col]) {
      out.push(base[row] ?? "");
      row += 1;
      col += 1;
    } else if ((scores[at(row + 1, col)] ?? 0) >= (scores[at(row, col + 1)] ?? 0)) row += 1;
    else col += 1;
  }
  return out;
}
