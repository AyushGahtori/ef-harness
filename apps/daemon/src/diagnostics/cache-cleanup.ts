import type { PinSafeCacheGcPort } from "./ports.js";

export function runSafeCacheCleanup(gc: PinSafeCacheGcPort): {
  readonly reclaimedBytes: number;
  readonly pinnedKept: number;
} {
  const result = gc.runSafeCacheCleanup();
  if (!Number.isFinite(result.reclaimedBytes) || !Number.isFinite(result.pinnedKept)) {
    throw new Error("pin-safe cache cleanup returned an invalid result");
  }
  if (result.reclaimedBytes < 0 || result.pinnedKept < 0) {
    throw new Error("pin-safe cache cleanup returned an invalid result");
  }
  return {
    reclaimedBytes: result.reclaimedBytes,
    pinnedKept: result.pinnedKept,
  };
}
