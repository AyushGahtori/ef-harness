import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { MappedStackFrame } from "./types.js";

interface OriginalPosition {
  source: string | null;
  line: number | null;
  column: number | null;
  name: string | null;
}

interface SourceMapConsumerInstance {
  originalPositionFor(query: { line: number; column: number }): OriginalPosition;
  destroy(): void;
}

interface SourceMapLibrary {
  SourceMapConsumer: new (raw: string) => Promise<SourceMapConsumerInstance>;
}

export interface ParsedFrame {
  readonly raw: string;
  readonly functionName: string | null;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly remote: boolean;
}

const FRAME_PATTERN =
  /(?:^|\s)(?:at\s+)?(?:async\s+)?(?:([^\s()]+)\s+\()?((?:https?:\/\/\S+?)|(?:[^\s():]+)):(\d+):(\d+)\)?/g;

function loadSourceMapLibrary(): SourceMapLibrary {
  const require = createRequire(import.meta.url);
  const loaded: unknown = require("source-map");
  if (!isSourceMapLibrary(loaded)) {
    throw new Error("The source-map library is not available to SourceMapStackMapper.");
  }
  return loaded;
}

function isSourceMapLibrary(value: unknown): value is SourceMapLibrary {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { SourceMapConsumer?: unknown };
  return typeof candidate.SourceMapConsumer === "function";
}

export function isRemoteReference(file: string): boolean {
  return /^https?:\/\//i.test(file) || /^\/\//.test(file);
}

export function parseStackFrames(stack: string): ParsedFrame[] {
  const frames: ParsedFrame[] = [];
  for (const line of stack.split(/\r?\n/)) {
    FRAME_PATTERN.lastIndex = 0;
    const match = FRAME_PATTERN.exec(line.trim());
    if (!match) continue;
    const file = match[2];
    const lineNumber = Number(match[3]);
    const column = Number(match[4]);
    if (!file || !Number.isInteger(lineNumber) || !Number.isInteger(column)) continue;
    frames.push({
      raw: line.trim(),
      functionName: match[1] ?? null,
      file,
      line: lineNumber,
      column,
      remote: isRemoteReference(file),
    });
  }
  return frames;
}

function isInsideRoot(root: string, candidate: string): boolean {
  const base = existsSync(root) ? realpathSync(root) : path.resolve(root);
  const target = path.resolve(candidate);
  const relative = path.relative(base, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function mappingComment(source: string): string | null {
  const line = /\/\/[#@]\s*sourceMappingURL=(\S+)/.exec(source);
  if (line?.[1]) return line[1];
  const block = /\/\*[#@]\s*sourceMappingURL=([^\s*]+)\s*\*\//.exec(source);
  return block?.[1] ?? null;
}

/**
 * Resolves minified frames with the local `source-map` library.
 * Remote map URLs are ignored and never fetched.
 */
export class SourceMapStackMapper {
  private readonly roots: readonly string[];
  private library: SourceMapLibrary | null = null;

  constructor(buildRoots: readonly string[]) {
    this.roots = buildRoots.map((root) => path.resolve(root));
  }

  async mapStack(stack: string): Promise<MappedStackFrame[]> {
    const frames = parseStackFrames(stack);
    const mapped: MappedStackFrame[] = [];
    for (const frame of frames) {
      mapped.push(await this.mapFrame(frame));
    }
    return mapped;
  }

  async mapFrame(frame: ParsedFrame): Promise<MappedStackFrame> {
    if (frame.remote) return preserve(frame, true);
    const mapPath = this.locateMap(frame.file);
    if (!mapPath) return preserve(frame, false);
    const position = await this.lookup(mapPath, frame.line, frame.column);
    if (!position?.source || position.line === null || position.column === null) return preserve(frame, false);
    return {
      raw: frame.raw,
      file: frame.file,
      line: frame.line,
      column: frame.column,
      functionName: position.name ?? frame.functionName,
      source: position.source.replaceAll("\\", "/"),
      originalLine: position.line,
      originalColumn: position.column,
      resolved: true,
      ignoredRemote: false,
    };
  }

  private locateMap(file: string): string | null {
    const baseName = path.posix.basename(file.replaceAll("\\", "/"));
    const mapName = baseName.endsWith(".map") ? baseName : `${baseName}.map`;
    for (const root of this.roots) {
      const candidates = [
        path.resolve(root, `${file}.map`),
        path.resolve(root, mapName),
        path.resolve(root, path.dirname(file), mapName),
      ];
      for (const candidate of candidates) {
        if (!isInsideRoot(root, candidate) || !existsSync(candidate)) continue;
        return candidate;
      }
      const script = this.locateScript(root, file, baseName);
      if (!script) continue;
      let text = "";
      try {
        text = readFileSync(script, "utf8");
      } catch {
        continue;
      }
      const comment = mappingComment(text);
      if (!comment || isRemoteReference(comment)) continue;
      const resolved = path.resolve(path.dirname(script), comment);
      if (isInsideRoot(root, resolved) && existsSync(resolved)) return resolved;
    }
    return null;
  }

  private locateScript(root: string, file: string, baseName: string): string | null {
    const candidates = [path.resolve(root, file), path.resolve(root, baseName)];
    for (const candidate of candidates) {
      if (candidate.endsWith(".map")) continue;
      if (isInsideRoot(root, candidate) && existsSync(candidate)) return candidate;
    }
    return null;
  }

  private async lookup(mapPath: string, line: number, column: number): Promise<OriginalPosition | null> {
    let raw = "";
    try {
      raw = readFileSync(mapPath, "utf8");
    } catch {
      return null;
    }
    const library = this.library ?? loadSourceMapLibrary();
    this.library = library;
    const consumer = await new library.SourceMapConsumer(raw);
    try {
      return consumer.originalPositionFor({ line, column });
    } finally {
      consumer.destroy();
    }
  }
}

function preserve(frame: ParsedFrame, ignoredRemote: boolean): MappedStackFrame {
  return {
    raw: frame.raw,
    file: frame.file,
    line: frame.line,
    column: frame.column,
    functionName: frame.functionName,
    source: null,
    originalLine: null,
    originalColumn: null,
    resolved: false,
    ignoredRemote,
  };
}
