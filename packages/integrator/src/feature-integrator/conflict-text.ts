import { CONTEXT_RADIUS } from "./constants.js";
import { DroppedSideError, UnrelatedEditError } from "./errors.js";
import type { ConflictHunk, ScopedConflictPacket } from "./types.js";

const OURS_MARK = "<".repeat(7);
const BASE_MARK = "|".repeat(7);
const SEP_MARK = "=".repeat(7);
const THEIRS_MARK = ">".repeat(7);

function splitLines(text: string): string[] {
  const normalized = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const lines = normalized.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function parseConflictHunks(path: string, conflicted: string): ConflictHunk[] {
  const lines = splitLines(conflicted);
  const hunks: ConflictHunk[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.startsWith(OURS_MARK)) {
      index += 1;
      continue;
    }
    const startLine = index + 1;
    const ours: string[] = [];
    const base: string[] = [];
    const theirs: string[] = [];
    let phase: "ours" | "base" | "theirs" = "ours";
    index += 1;
    let closed = false;
    while (index < lines.length) {
      const current = lines[index] ?? "";
      if (phase === "ours" && current.startsWith(BASE_MARK)) {
        phase = "base";
        index += 1;
        continue;
      }
      if ((phase === "ours" || phase === "base") && current.startsWith(SEP_MARK)) {
        phase = "theirs";
        index += 1;
        continue;
      }
      if (phase === "theirs" && current.startsWith(THEIRS_MARK)) {
        const endLine = index + 1;
        const beforeStart = Math.max(0, startLine - 1 - CONTEXT_RADIUS);
        hunks.push({
          path,
          startLine,
          endLine,
          base: base.join("\n"),
          ours: ours.join("\n"),
          theirs: theirs.join("\n"),
          contextBefore: lines.slice(beforeStart, startLine - 1),
          contextAfter: lines.slice(endLine, endLine + CONTEXT_RADIUS),
        });
        index += 1;
        closed = true;
        break;
      }
      if (phase === "ours") ours.push(current);
      else if (phase === "base") base.push(current);
      else theirs.push(current);
      index += 1;
    }
    if (!closed) break;
  }
  return hunks;
}

export function reconstructSide(conflicted: string, side: "ours" | "theirs"): string {
  const lines = splitLines(conflicted);
  const kept: string[] = [];
  let phase: "context" | "ours" | "base" | "theirs" = "context";
  for (const line of lines) {
    if (phase === "context" && line.startsWith(OURS_MARK)) {
      phase = "ours";
      continue;
    }
    if (phase === "ours" && line.startsWith(BASE_MARK)) {
      phase = "base";
      continue;
    }
    if ((phase === "ours" || phase === "base") && line.startsWith(SEP_MARK)) {
      phase = "theirs";
      continue;
    }
    if (phase === "theirs" && line.startsWith(THEIRS_MARK)) {
      phase = "context";
      continue;
    }
    if (phase === "context" || phase === side || (phase === "base" && side === "ours")) {
      if (phase === "base") continue;
      kept.push(line);
    }
  }
  return `${kept.join("\n")}\n`;
}

export function buildScopedConflictPrompt(packet: ScopedConflictPacket): string {
  const blocks = packet.hunks.map((hunk) => {
    const before = hunk.contextBefore.slice(-CONTEXT_RADIUS);
    const after = hunk.contextAfter.slice(0, CONTEXT_RADIUS);
    return [
      `path: ${hunk.path}`,
      `lines: ${hunk.startLine}-${hunk.endLine}`,
      "context-before:",
      ...before,
      "ours:",
      hunk.ours,
      "base:",
      hunk.base,
      "theirs:",
      hunk.theirs,
      "context-after:",
      ...after,
    ].join("\n");
  });
  const objectives = packet.objectives.map((item) => `${item.taskId}: ${item.objective}`);
  return ["feature-integrator@1 scoped conflict packet", "objectives:", ...objectives, ...blocks].join("\n");
}

export function featureSymbols(text: string): string[] {
  const symbols = new Set<string>();
  for (const match of text.matchAll(/import\s+(?:type\s+)?\{([^}]+)\}\s+from/g)) {
    for (const part of (match[1] ?? "").split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim() ?? "";
      if (name) symbols.add(name);
    }
  }
  for (const match of text.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from/g)) {
    const name = match[1];
    if (name) symbols.add(name);
  }
  for (const match of text.matchAll(/export\s+\{([^}]+)\}/g)) {
    for (const part of (match[1] ?? "").split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim() ?? "";
      if (name) symbols.add(name);
    }
  }
  for (const match of text.matchAll(
    /export\s+(?:async\s+)?(?:function|const|class|let|var|type|interface)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    const name = match[1];
    if (name) symbols.add(name);
  }
  for (const match of text.matchAll(/["'](\/[A-Za-z0-9_\-./]+)["']/g)) {
    const route = match[1];
    if (route) symbols.add(route);
  }
  return [...symbols];
}

export function assertBothSidesSurvive(path: string, ours: string, theirs: string, resolved: string): void {
  const resolvedSymbols = new Set(featureSymbols(resolved));
  for (const symbol of featureSymbols(ours)) {
    if (!resolvedSymbols.has(symbol)) {
      throw new DroppedSideError(path, "ours", symbol);
    }
  }
  for (const symbol of featureSymbols(theirs)) {
    if (!resolvedSymbols.has(symbol)) {
      throw new DroppedSideError(path, "theirs", symbol);
    }
  }
}

export function assertAllowedPaths(paths: readonly string[], allowed: ReadonlySet<string>): void {
  for (const path of paths) {
    if (!allowed.has(path.replaceAll("\\", "/"))) {
      throw new UnrelatedEditError(path);
    }
  }
}

function uniqueLines(lines: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const line of lines) {
    if (seen.has(line)) continue;
    seen.add(line);
    result.push(line);
  }
  return result;
}

function isImport(line: string): boolean {
  return line.trimStart().startsWith("import ");
}

function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of input) {
    if (char === "{" || char === "[" || char === "(") depth += 1;
    if (char === "}" || char === "]" || char === ")") depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function routeElements(text: string): string[] {
  const match = /export const routes\s*=\s*\[([\s\S]*?)\]\s*;?/.exec(text);
  if (!match) return [];
  return splitTopLevel(match[1] ?? "");
}

export function isRouteModule(path: string, text: string): boolean {
  const base = path.replaceAll("\\", "/").split("/").pop() ?? path;
  return base === "routes.ts" || base === "router.ts" || /export const routes\b/.test(text);
}

export function mergeRouteModules(ours: string, theirs: string): string {
  const oursLines = splitLines(ours);
  const theirsLines = splitLines(theirs);
  const imports = uniqueLines([
    ...oursLines.filter(isImport),
    ...theirsLines.filter(isImport),
  ]);
  const routes = uniqueLines([...routeElements(ours), ...routeElements(theirs)]);
  const other = uniqueLines(
    [...oursLines, ...theirsLines].filter((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !isImport(line) && !trimmed.startsWith("export const routes");
    }),
  );
  const body = [`export const routes = [${routes.join(", ")}];`, ...other];
  return `${[...imports, "", ...body].join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}

export function mergeExportLines(ours: string, theirs: string): string {
  const lines = uniqueLines(
    [...splitLines(ours), ...splitLines(theirs)].filter((line) => line.trim().length > 0),
  );
  return `${lines.join("\n")}\n`;
}

function mergeHunkBody(base: string, ours: string, theirs: string): string {
  const baseLines = splitLines(base);
  const oursLines = splitLines(ours);
  const theirsLines = splitLines(theirs);
  const kept = baseLines.filter((line) => oursLines.includes(line) || theirsLines.includes(line));
  const added: string[] = [];
  for (const line of [...oursLines, ...theirsLines]) {
    if (baseLines.includes(line) || added.includes(line) || kept.includes(line)) continue;
    added.push(line);
  }
  return [...kept, ...added].join("\n");
}

export function spliceHunks(conflicted: string, hunks: readonly ConflictHunk[]): string {
  const lines = splitLines(conflicted);
  const output: string[] = [];
  let index = 0;
  const ordered = [...hunks].sort((left, right) => left.startLine - right.startLine);
  for (const hunk of ordered) {
    const start = hunk.startLine - 1;
    while (index < start) {
      output.push(lines[index] ?? "");
      index += 1;
    }
    const merged = mergeHunkBody(hunk.base, hunk.ours, hunk.theirs);
    if (merged.length > 0) output.push(...splitLines(merged));
    index = hunk.endLine;
  }
  while (index < lines.length) {
    output.push(lines[index] ?? "");
    index += 1;
  }
  return `${output.join("\n")}\n`;
}

export function resolveConflictText(input: {
  readonly path: string;
  readonly conflicted: string;
  readonly hunks: readonly ConflictHunk[];
  readonly oursText: string;
  readonly theirsText: string;
}): string {
  if (isRouteModule(input.path, input.oursText) || isRouteModule(input.path, input.theirsText)) {
    return mergeRouteModules(input.oursText, input.theirsText);
  }
  const baseName = input.path.replaceAll("\\", "/").split("/").pop() ?? "";
  if (baseName === "index.ts" || baseName === "index.tsx") {
    return mergeExportLines(input.oursText, input.theirsText);
  }
  return spliceHunks(input.conflicted, input.hunks);
}
