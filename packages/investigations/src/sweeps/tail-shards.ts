import type { TailShard } from "./types.js";
import { MAX_TAIL_SHARD_FILES } from "./types.js";

export function partitionTailShards(paths: readonly string[]): readonly TailShard[] {
  const sorted = [...paths].sort((a, b) => a.localeCompare(b));
  const shards: TailShard[] = [];
  for (let i = 0; i < sorted.length; i += MAX_TAIL_SHARD_FILES) {
    const slice = sorted.slice(i, i + MAX_TAIL_SHARD_FILES);
    shards.push({
      shardId: `tail-${String(shards.length + 1).padStart(2, "0")}`,
      paths: Object.freeze(slice),
    });
  }
  return Object.freeze(shards);
}