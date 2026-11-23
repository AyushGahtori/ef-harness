import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Whisper's GPT-2 byte-level BPE.
 * Ranks come from whisper.cpp / openai-whisper `gpt2.tiktoken`.
 * Merges are recovered in rank order so token ids match tiktoken's gpt2
 * encoding, which is what whisper.cpp counts against the 224-token prompt.
 */
const GPT2_PATTERN =
  /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;

const VOCAB_LIMIT = 50257;

interface BpeModel {
  readonly byteId: Uint32Array;
  readonly bucket: Array<Map<number, number> | undefined>;
}

let model: BpeModel | undefined;

function loadModel(): BpeModel {
  if (model) return model;
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "gpt2.tiktoken");
  const text = fs.readFileSync(file, "utf8");
  const tokens: Uint8Array[] = [];
  const byteId = new Uint32Array(256);
  byteId.fill(0xffffffff);
  let count = 0;
  for (const line of text.split(/\n/)) {
    if (!line) continue;
    const space = line.indexOf(" ");
    if (space <= 0) continue;
    const bytes = Buffer.from(line.slice(0, space), "base64");
    const rank = Number(line.slice(space + 1));
    tokens[rank] = bytes;
    if (bytes.length === 1) byteId[bytes[0] ?? 0] = rank;
    count += 1;
  }
  if (count < 50_000) {
    throw new Error(`Whisper BPE rank table is incomplete (${count} tokens)`);
  }
  for (let byte = 0; byte < 256; byte += 1) {
    if (byteId[byte] === 0xffffffff) {
      throw new Error(`Whisper BPE rank table is missing byte ${byte}`);
    }
  }

  const bucket: Array<Map<number, number> | undefined> = new Array(VOCAB_LIMIT);
  const scratch = new Uint32Array(256);

  const encodeKnown = (bytes: Uint8Array): number => {
    const length = bytes.length;
    if (length > scratch.length) {
      throw new Error("Whisper BPE token is longer than the merge scratch buffer");
    }
    for (let i = 0; i < length; i += 1) scratch[i] = byteId[bytes[i] ?? 0] ?? 0;
    let size = length;
    while (size >= 2) {
      let best = 0xffffffff;
      let index = -1;
      for (let i = 0; i < size - 1; i += 1) {
        const merged = bucket[scratch[i] ?? 0]?.get(scratch[i + 1] ?? 0);
        if (merged !== undefined && merged < best) {
          best = merged;
          index = i;
        }
      }
      if (index < 0) break;
      scratch[index] = best;
      scratch.copyWithin(index + 1, index + 2, size);
      size -= 1;
    }
    return size;
  };

  for (let rank = 0; rank < tokens.length; rank += 1) {
    const bytes = tokens[rank];
    if (!bytes || bytes.length < 2) continue;
    const size = encodeKnown(bytes);
    if (size !== 2) {
      throw new Error(`Whisper BPE could not recover the merge for token ${rank}`);
    }
    const left = scratch[0] ?? 0;
    const right = scratch[1] ?? 0;
    let row = bucket[left];
    if (!row) {
      row = new Map();
      bucket[left] = row;
    }
    row.set(right, rank);
  }

  model = { byteId, bucket };
  return model;
}

/** Force the rank table and merge map to load before a timed hot path. */
export function warmWhisperBpe(): number {
  const loaded = loadModel();
  let rows = 0;
  for (const row of loaded.bucket) {
    if (row) rows += 1;
  }
  return rows;
}

function encodeBytes(bytes: Uint8Array, loaded: BpeModel): number[] {
  const length = bytes.length;
  if (length === 0) return [];
  if (length === 1) return [loaded.byteId[bytes[0] ?? 0] ?? 0];
  const id = new Uint32Array(length);
  for (let i = 0; i < length; i += 1) id[i] = loaded.byteId[bytes[i] ?? 0] ?? 0;
  let size = length;
  while (size >= 2) {
    let best = 0xffffffff;
    let index = -1;
    for (let i = 0; i < size - 1; i += 1) {
      const merged = loaded.bucket[id[i] ?? 0]?.get(id[i + 1] ?? 0);
      if (merged !== undefined && merged < best) {
        best = merged;
        index = i;
      }
    }
    if (index < 0) break;
    id[index] = best;
    id.copyWithin(index + 1, index + 2, size);
    size -= 1;
  }
  const ids = new Array<number>(size);
  for (let i = 0; i < size; i += 1) ids[i] = id[i] ?? 0;
  return ids;
}

const encodeCache = new Map<string, readonly number[]>();

/** Encode `text` with Whisper's exact GPT-2 BPE tokenizer. */
export function encodeWhisperBpe(text: string): readonly number[] {
  if (!text) return [];
  const cached = encodeCache.get(text);
  if (cached) return cached;
  const loaded = loadModel();
  const ids: number[] = [];
  GPT2_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(GPT2_PATTERN)) {
    const piece = match[0];
    if (!piece) continue;
    ids.push(...encodeBytes(Buffer.from(piece, "utf8"), loaded));
  }
  encodeCache.set(text, ids);
  return ids;
}

export function countWhisperBpeTokens(text: string): number {
  return encodeWhisperBpe(text).length;
}
