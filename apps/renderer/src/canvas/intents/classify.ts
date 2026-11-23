import type { ChangeClass } from "./types.js";

const CLARIFYING_PHRASE = /\b(e\.g\.|for example|for instance|such as|must include|including|for clarity)\b/i;
const TIME_TOKEN = /\b\d{1,2}:\d{2}(?:\s*[AaPp][Mm])?\b/g;
const NUMBER_TOKEN = /\d+(?::\d+)?/g;

export function classifyWording(before: string, after: string): ChangeClass {
  if (normalize(before) === normalize(after)) return "cosmetic";
  if (!sameTokens(before, after, NUMBER_TOKEN) || !sameTokens(before, after, TIME_TOKEN)) {
    return "breaking";
  }
  if (clarifying(before, after)) return "clarifying";
  if (isTypo(before, after)) return "cosmetic";
  return "breaking";
}

export function misheardPair(before: string, after: string): { readonly heard: string; readonly intended: string } | null {
  if (normalize(before) === normalize(after)) return null;
  const beforeTimes = tokens(before, TIME_TOKEN);
  const afterTimes = tokens(after, TIME_TOKEN);
  const heardTime = beforeTimes[0];
  const intendedTime = afterTimes[0];
  if (heardTime && intendedTime && heardTime !== intendedTime) {
    return { heard: heardTime, intended: intendedTime };
  }
  const heard = before.trim();
  const intended = after.trim();
  if (!heard || !intended || heard === intended) return null;
  return { heard, intended };
}

export function projectWording(
  text: string,
  value: string,
  draft: string,
): { readonly text: string; readonly value: string } {
  const next = draft.trim();
  if (!next) return { text, value };
  if (!value) return { text: next, value: "" };
  if (text.includes(value) && value !== next) {
    return { text: text.replaceAll(value, next), value: next };
  }
  return { text: text === value ? next : text, value: next };
}

export function formatPair(heard: string, intended: string): string {
  return `${heard} → ${intended}`;
}

function clarifying(before: string, after: string): boolean {
  const beforeHit = CLARIFYING_PHRASE.test(before);
  const afterHit = CLARIFYING_PHRASE.test(after);
  if (afterHit && !beforeHit) return true;
  return afterHit && after.trim().length > before.trim().length;
}

function isTypo(before: string, after: string): boolean {
  const left = words(before);
  const right = words(after);
  if (left.length !== right.length || left.length === 0) return false;
  let changed = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === undefined || b === undefined) return false;
    if (a === b) continue;
    changed += 1;
    if (changed > 2 || levenshtein(a, b) > 2) return false;
  }
  return changed > 0;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function words(value: string): string[] {
  const normalized = normalize(value);
  return normalized.length === 0 ? [] : normalized.split(" ");
}

function tokens(value: string, pattern: RegExp): string[] {
  return value.match(pattern) ?? [];
}

function sameTokens(before: string, after: string, pattern: RegExp): boolean {
  const left = tokens(before, pattern);
  const right = tokens(after, pattern);
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function levenshtein(left: string, right: string): number {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const grid: number[][] = [];
  for (let row = 0; row < rows; row += 1) {
    const line: number[] = [];
    for (let col = 0; col < cols; col += 1) line.push(0);
    const first = line[0];
    if (first === undefined) return left.length + right.length;
    line[0] = row;
    grid.push(line);
  }
  const header = grid[0];
  if (!header) return left.length + right.length;
  for (let col = 0; col < cols; col += 1) header[col] = col;
  for (let row = 1; row < rows; row += 1) {
    const current = grid[row];
    const previous = grid[row - 1];
    if (!current || !previous) return left.length + right.length;
    for (let col = 1; col < cols; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;
      const del = (previous[col] ?? 0) + 1;
      const ins = (current[col - 1] ?? 0) + 1;
      const sub = (previous[col - 1] ?? 0) + cost;
      current[col] = Math.min(del, ins, sub);
    }
  }
  return grid[left.length]?.[right.length] ?? left.length + right.length;
}
