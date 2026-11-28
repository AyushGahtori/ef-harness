import { CONTEXT_LINES } from "./constants.js";
import { DroppedSideError } from "./errors.js";
import type { ConflictHunk } from "./types.js";

const OURS = "<".repeat(7);
const MID = "=".repeat(7);
const THEIRS = ">".repeat(7);

export function splitLines(text: string): string[] {
  return text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
}

export function hasConflictMarkers(text: string): boolean {
  return splitLines(text).some((line) => line.startsWith(OURS) || line.startsWith(THEIRS) || line.startsWith(MID));
}

export function parseConflictHunks(filePath: string, text: string): ConflictHunk[] {
  const lines = splitLines(text);
  const hunks: ConflictHunk[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.startsWith(OURS)) {
      index += 1;
      continue;
    }
    const contextBefore = lines.slice(Math.max(0, index - CONTEXT_LINES), index);
    index += 1;
    const ours: string[] = [];
    while (index < lines.length && !(lines[index] ?? "").startsWith(MID)) {
      ours.push(lines[index] ?? "");
      index += 1;
    }
    if ((lines[index] ?? "").startsWith(MID)) index += 1;
    const theirs: string[] = [];
    while (index < lines.length && !(lines[index] ?? "").startsWith(THEIRS)) {
      theirs.push(lines[index] ?? "");
      index += 1;
    }
    if ((lines[index] ?? "").startsWith(THEIRS)) index += 1;
    const contextAfter = lines.slice(index, index + CONTEXT_LINES);
    hunks.push({ path: filePath, ours, theirs, contextBefore, contextAfter });
  }
  return hunks;
}

export function unionConflictText(text: string): string {
  const lines = splitLines(text);
  const out: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.startsWith(OURS)) {
      out.push(line);
      index += 1;
      continue;
    }
    index += 1;
    const ours: string[] = [];
    while (index < lines.length && !(lines[index] ?? "").startsWith(MID)) {
      ours.push(lines[index] ?? "");
      index += 1;
    }
    if ((lines[index] ?? "").startsWith(MID)) index += 1;
    const theirs: string[] = [];
    while (index < lines.length && !(lines[index] ?? "").startsWith(THEIRS)) {
      theirs.push(lines[index] ?? "");
      index += 1;
    }
    if ((lines[index] ?? "").startsWith(THEIRS)) index += 1;
    out.push(...ours);
    for (const theirsLine of theirs) {
      if (!ours.includes(theirsLine)) out.push(theirsLine);
    }
  }
  const body = out.join("\n");
  return text.endsWith("\n") || text.endsWith("\r\n") ? `${body}\n` : body;
}

export function sideLines(text: string): string[] {
  const lines: string[] = [];
  for (const hunk of parseConflictHunks("conflict", text)) {
    for (const line of [...hunk.ours, ...hunk.theirs]) {
      if (line.trim().length > 0) lines.push(line);
    }
  }
  return lines;
}

export function assertSidesKept(filePath: string, original: string, resolved: string): void {
  for (const line of sideLines(original)) {
    if (!splitLines(resolved).includes(line)) {
      throw new DroppedSideError(filePath, line);
    }
  }
}
