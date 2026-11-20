import { createHash } from "node:crypto";

export function sha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Logical lines. A trailing newline does not create an extra empty line.
 * Empty input is zero lines. Line text does not include the terminator.
 */
export function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const normalized = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const parts = normalized.split("\n");
  if (normalized.endsWith("\n") && parts.length > 0 && parts[parts.length - 1] === "") {
    parts.pop();
  }
  return parts;
}

export function formatGroupedNumber(value: number): string {
  return Math.trunc(value).toLocaleString("en-US");
}

export function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

export function lineLabel(lineNumber: number, totalLines: number): string {
  const width = Math.max(4, String(Math.max(totalLines, 0)).length);
  return `L${String(lineNumber).padStart(width, "0")}`;
}

export function clampText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

export function isPascalCase(name: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(name);
}

export function replaceAllLiteral(input: string, needle: string, replacement: string): string {
  if (needle.length === 0) return input;
  return input.split(needle).join(replacement);
}

export function longestConsecutiveRun(
  lines: readonly string[],
  skip: (line: string) => boolean,
): { readonly text: string; readonly count: number } | null {
  let bestText = "";
  let bestCount = 1;
  let index = 0;
  while (index < lines.length) {
    const current = lines[index] ?? "";
    if (current.trim().length === 0 || skip(current)) {
      index += 1;
      continue;
    }
    let next = index + 1;
    while (next < lines.length && lines[next] === current) next += 1;
    const count = next - index;
    if (count > bestCount) {
      bestCount = count;
      bestText = current.trim();
    }
    index = next;
  }
  if (bestCount < 3) return null;
  return { text: clampText(bestText, 160), count: bestCount };
}
