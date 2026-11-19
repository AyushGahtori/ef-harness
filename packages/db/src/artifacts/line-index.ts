import { LINE_INDEX_SAMPLE_EVERY } from "./constants.js";

export { LINE_INDEX_SAMPLE_EVERY };

export interface LineIndexEntry {
  readonly lineNumber: number;
  readonly frameIndex: number;
  readonly uncompressedOffsetInFrame: number;
}

export interface LineIndex {
  readonly version: 1;
  readonly totalLines: number;
  readonly totalUncompressedBytes: number;
  readonly sampleEvery: number;
  readonly entries: readonly LineIndexEntry[];
}

export function serializeLineIndex(index: LineIndex): Buffer {
  return Buffer.from(JSON.stringify(index), "utf8");
}

export function parseLineIndex(bytes: Uint8Array): LineIndex {
  const parsed: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
  if (!isLineIndex(parsed)) {
    throw new Error("Sidecar line index is not a version 1 index.");
  }
  return parsed;
}

function isLineIndex(value: unknown): value is LineIndex {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.version !== 1) return false;
  if (typeof record.totalLines !== "number" || !Number.isInteger(record.totalLines)) return false;
  if (typeof record.totalUncompressedBytes !== "number") return false;
  if (record.sampleEvery !== LINE_INDEX_SAMPLE_EVERY) return false;
  if (!Array.isArray(record.entries)) return false;
  return record.entries.every((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const row = entry as Record<string, unknown>;
    return (
      typeof row.lineNumber === "number" &&
      Number.isInteger(row.lineNumber) &&
      row.lineNumber > 0 &&
      typeof row.frameIndex === "number" &&
      Number.isInteger(row.frameIndex) &&
      row.frameIndex >= 0 &&
      typeof row.uncompressedOffsetInFrame === "number" &&
      Number.isInteger(row.uncompressedOffsetInFrame) &&
      row.uncompressedOffsetInFrame >= 0
    );
  });
}
