export const LONG_TURN_CHUNK_MAX_CHARS = 4_000;
export const LONG_TURN_CHUNK_OVERLAP_CHARS = 400;

export interface TurnChunk {
  readonly index: number;
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface ChunkBounds {
  readonly maxChars?: number;
  readonly overlapChars?: number;
}

/**
 * Split one submitted turn into bounded overlapping chunks.
 * Offsets are half-open `[start, end)` indexes into that same string.
 */
export function chunkTurnWithOffsets(text: string, bounds: ChunkBounds = {}): TurnChunk[] {
  const maxChars = bounds.maxChars ?? LONG_TURN_CHUNK_MAX_CHARS;
  const overlapChars = bounds.overlapChars ?? LONG_TURN_CHUNK_OVERLAP_CHARS;
  if (!Number.isInteger(maxChars) || maxChars < 1) {
    throw new Error("chunk maxChars must be a positive integer");
  }
  if (!Number.isInteger(overlapChars) || overlapChars < 0 || overlapChars >= maxChars) {
    throw new Error("chunk overlap must be smaller than maxChars");
  }
  if (text.length === 0) return [];
  if (text.length <= maxChars) {
    return [{ index: 0, start: 0, end: text.length, text }];
  }
  const step = maxChars - overlapChars;
  const chunks: TurnChunk[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(text.length, start + maxChars);
    const slice = text.slice(start, end);
    chunks.push({ index: chunks.length, start, end, text: slice });
    if (end === text.length) break;
    start += step;
  }
  return chunks;
}

/** Translate a chunk-local `[localStart, localEnd)` span back onto the original turn. */
export function absoluteOffsets(
  chunk: TurnChunk,
  localStart: number,
  localEnd: number,
): { start: number; end: number } {
  if (!Number.isInteger(localStart) || !Number.isInteger(localEnd)) {
    throw new Error("chunk-local offsets must be integers");
  }
  const span = chunk.end - chunk.start;
  if (localStart < 0 || localEnd < localStart || localEnd > span) {
    throw new Error("chunk-local offset is outside the chunk");
  }
  return { start: chunk.start + localStart, end: chunk.start + localEnd };
}
