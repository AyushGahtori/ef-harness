import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { zstdCompressSync, zstdDecompressSync } from "node:zlib";
import { FRAME_TARGET_BYTES, LINE_INDEX_INTERVAL, SEEKABLE_THRESHOLD_BYTES } from "./constants.js";
import { InvalidLineRangeError } from "./errors.js";
import type { ArtifactManager, ArtifactRecord, LogRange, RetentionClass, StoreArtifactRequest } from "./types.js";

interface FrameRange {
  readonly start: number;
  readonly end: number;
}

interface IndexEntry {
  readonly line: number;
  readonly frame: number;
  readonly offset: number;
}

interface ArtifactMeta extends ArtifactRecord {
  readonly attemptId: string;
  readonly kind: string;
}

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const parts = text.split("\n");
  if (parts[parts.length - 1] === "") parts.pop();
  return parts.map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
}

function countLines(body: Buffer): number {
  if (body.length === 0) return 0;
  let lines = 0;
  for (let index = 0; index < body.length; index += 1) {
    if (body[index] === 0x0a) lines += 1;
  }
  if (body[body.length - 1] !== 0x0a) lines += 1;
  return lines;
}

function utf8Boundary(body: Buffer, end: number): number {
  let cursor = end;
  while (cursor > 0 && (body[cursor] ?? 0) >= 0x80 && (body[cursor] ?? 0) < 0xc0) {
    cursor -= 1;
  }
  return cursor === 0 ? end : cursor;
}

function frameRanges(body: Buffer): FrameRange[] {
  const ranges: FrameRange[] = [];
  let offset = 0;
  while (offset < body.length) {
    let end = Math.min(body.length, offset + FRAME_TARGET_BYTES);
    if (end < body.length) {
      let newline = -1;
      const floor = Math.max(offset + 1, end - 256 * 1024);
      for (let index = end - 1; index >= floor; index -= 1) {
        if (body[index] === 0x0a) {
          newline = index + 1;
          break;
        }
      }
      end = newline > offset ? newline : utf8Boundary(body, end);
      if (end <= offset) end = Math.min(body.length, offset + FRAME_TARGET_BYTES);
    }
    ranges.push({ start: offset, end });
    offset = end;
  }
  return ranges;
}

function lineIndex(body: Buffer, ranges: readonly FrameRange[]): IndexEntry[] {
  const entries: IndexEntry[] = [];
  let line = 1;
  let lineStart = 0;
  const push = (start: number, lineNumber: number): void => {
    let frame = 0;
    for (let index = 0; index < ranges.length; index += 1) {
      const range = ranges[index];
      if (range !== undefined && start >= range.start && start < range.end) {
        frame = index;
        break;
      }
      if (range !== undefined && start === range.end && index === ranges.length - 1) {
        frame = index;
      }
    }
    const range = ranges[frame];
    entries.push({
      line: lineNumber,
      frame,
      offset: range === undefined ? 0 : start - range.start,
    });
  };
  if (body.length === 0) return [{ line: 1, frame: 0, offset: 0 }];
  push(0, 1);
  for (let index = 0; index < body.length; index += 1) {
    if (body[index] !== 0x0a) continue;
    line += 1;
    lineStart = index + 1;
    if (lineStart >= body.length) break;
    if ((line - 1) % LINE_INDEX_INTERVAL === 0) push(lineStart, line);
  }
  return entries;
}

export class LocalArtifactManager implements ArtifactManager {
  constructor(private readonly root: string) {
    fs.mkdirSync(root, { recursive: true });
  }

  async storeArtifact(request: StoreArtifactRequest): Promise<ArtifactRecord> {
    const hash = createHash("sha256").update(request.body).digest("hex");
    const artifactId = `sha256:${hash}`;
    const dir = this.directory(artifactId);
    fs.mkdirSync(dir, { recursive: true });
    const seekable = request.body.length > SEEKABLE_THRESHOLD_BYTES;
    const lineCount = countLines(request.body);
    if (seekable) {
      const ranges = frameRanges(request.body);
      const entries = lineIndex(request.body, ranges);
      ranges.forEach((range, index) => {
        const slice = request.body.subarray(range.start, range.end);
        fs.writeFileSync(path.join(dir, `frame-${index}.zst`), zstdCompressSync(slice));
      });
      fs.writeFileSync(
        path.join(dir, "index.json"),
        JSON.stringify({ interval: LINE_INDEX_INTERVAL, frameCount: ranges.length, entries }),
      );
    } else {
      fs.writeFileSync(path.join(dir, "body.bin"), request.body);
    }
    const existing = this.readMeta(artifactId);
    const retention = existing?.retention === "evidence" ? "evidence" : request.retention;
    const meta: ArtifactMeta = {
      artifactId,
      byteLength: request.body.length,
      retention,
      seekable,
      lineCount,
      format: seekable ? "zstd-seekable" : "plain",
      attemptId: request.attemptId,
      kind: request.kind,
    };
    fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta));
    return {
      artifactId: meta.artifactId,
      byteLength: meta.byteLength,
      retention: meta.retention,
      seekable: meta.seekable,
      lineCount: meta.lineCount,
      format: meta.format,
    };
  }

  async readLogRange(artifactId: string, startLine: number, endLine: number): Promise<LogRange> {
    if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) {
      throw new InvalidLineRangeError(`invalid line range ${startLine}..${endLine}`);
    }
    const meta = this.requireMeta(artifactId);
    if (startLine > meta.lineCount) {
      return { lines: [], totalLines: meta.lineCount, truncated: false };
    }
    const lines = meta.seekable ? this.readSeekableLines(artifactId, startLine, endLine) : splitLines(this.readPlain(artifactId).toString("utf8")).slice(startLine - 1, endLine);
    return { lines, totalLines: meta.lineCount, truncated: false };
  }

  async readRaw(artifactId: string): Promise<Buffer> {
    const meta = this.requireMeta(artifactId);
    if (!meta.seekable) return this.readPlain(artifactId);
    const index = this.readIndex(artifactId);
    const parts: Buffer[] = [];
    for (let frame = 0; frame < index.frameCount; frame += 1) {
      parts.push(zstdDecompressSync(fs.readFileSync(this.framePath(artifactId, frame))));
    }
    return Buffer.concat(parts);
  }

  async promoteRetention(artifactId: string, retention: "evidence"): Promise<void> {
    const meta = this.requireMeta(artifactId);
    fs.writeFileSync(
      path.join(this.directory(artifactId), "meta.json"),
      JSON.stringify({ ...meta, retention }),
    );
  }

  async retentionOf(artifactId: string): Promise<RetentionClass> {
    return this.requireMeta(artifactId).retention;
  }

  private readSeekableLines(artifactId: string, startLine: number, endLine: number): string[] {
    const index = this.readIndex(artifactId);
    let entry = index.entries[0] ?? { line: 1, frame: 0, offset: 0 };
    for (const candidate of index.entries) {
      if (candidate.line <= startLine) entry = candidate;
    }
    const parts: Buffer[] = [];
    for (let frame = entry.frame; frame < index.frameCount; frame += 1) {
      let plain = zstdDecompressSync(fs.readFileSync(this.framePath(artifactId, frame)));
      if (frame === entry.frame && entry.offset > 0) plain = plain.subarray(entry.offset);
      parts.push(plain);
      const joined = Buffer.concat(parts);
      const finalFrame = frame === index.frameCount - 1;
      let newlines = 0;
      for (let indexByte = 0; indexByte < joined.length; indexByte += 1) {
        if (joined[indexByte] === 0x0a) newlines += 1;
      }
      const lastCompleteLine = entry.line - 1 + newlines;
      if (!finalFrame && lastCompleteLine < endLine) continue;
      const lines = splitLines(joined.toString("utf8"));
      return lines.slice(startLine - entry.line, endLine - entry.line + 1);
    }
    return [];
  }

  private readPlain(artifactId: string): Buffer {
    return fs.readFileSync(path.join(this.directory(artifactId), "body.bin"));
  }

  private readIndex(artifactId: string): { frameCount: number; entries: IndexEntry[] } {
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(this.directory(artifactId), "index.json"), "utf8"));
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error(`artifact index is unreadable: ${artifactId}`);
    }
    const frameCount = "frameCount" in parsed && typeof parsed.frameCount === "number" ? parsed.frameCount : 0;
    const entries = "entries" in parsed && Array.isArray(parsed.entries) ? parsed.entries.flatMap((entry) => {
      if (typeof entry !== "object" || entry === null) return [];
      if (!("line" in entry) || !("frame" in entry) || !("offset" in entry)) return [];
      if (typeof entry.line !== "number" || typeof entry.frame !== "number" || typeof entry.offset !== "number") {
        return [];
      }
      return [{ line: entry.line, frame: entry.frame, offset: entry.offset }];
    }) : [];
    return { frameCount, entries };
  }

  private requireMeta(artifactId: string): ArtifactMeta {
    const meta = this.readMeta(artifactId);
    if (meta === null) throw new Error(`artifact not found: ${artifactId}`);
    return meta;
  }

  private readMeta(artifactId: string): ArtifactMeta | null {
    const file = path.join(this.directory(artifactId), "meta.json");
    if (!fs.existsSync(file)) return null;
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    if (!("artifactId" in parsed) || parsed.artifactId !== artifactId) return null;
    return parsed as ArtifactMeta;
  }

  private directory(artifactId: string): string {
    const hash = artifactId.startsWith("sha256:") ? artifactId.slice("sha256:".length) : artifactId;
    return path.join(this.root, hash);
  }

  private framePath(artifactId: string, frame: number): string {
    return path.join(this.directory(artifactId), `frame-${frame}.zst`);
  }
}
