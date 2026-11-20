import os from "node:os";

/**
 * Classify the host against a target RAM class.
 * A larger host must not be treated as if the target class had that extra RAM.
 *
 * @param {number} hostTotalMb
 * @param {16 | 32} targetGb
 * @returns {"direct" | "scale_annotation" | "not_measured_on_host"}
 */
export function measurementMode(hostTotalMb, targetGb) {
  const targetMb = targetGb * 1024;
  const ratio = hostTotalMb / targetMb;
  if (ratio >= 0.85 && ratio <= 1.25) return "direct";
  if (hostTotalMb > targetMb * 1.25) return "scale_annotation";
  return "not_measured_on_host";
}

/**
 * Project a measured per-worker footprint onto a smaller RAM budget.
 * Returns false when the projected commit would exceed 90% of that budget.
 *
 * @param {{ baselineCommitMb: number, perWorkerMb: number, workers: number, targetGb: number }} input
 */
export function fitsRamBudget(input) {
  const budgetMb = input.targetGb * 1024 * 0.9;
  const projected = input.baselineCommitMb + input.perWorkerMb * input.workers;
  return {
    projectedCommitMb: projected,
    budgetMb,
    fits: projected < budgetMb,
  };
}

/**
 * Commit real pages. Call release() so the benchmark does not keep the block.
 * @param {number} bytes
 */
export function allocateCommitted(bytes) {
  const block = Buffer.alloc(bytes, 7);
  let released = false;
  return {
    bytes: block.length,
    held: true,
    touch() {
      return block[0] + block[block.length - 1];
    },
    release() {
      block.fill(0);
      released = true;
      return released;
    },
  };
}

export function hostTotalMb() {
  return Math.round(os.totalmem() / (1024 * 1024));
}

/**
 * How many bytes of session-process ballast we can hold without dropping
 * free physical memory below the safety floor.
 * @param {number} freeBytes
 * @param {number} workers
 * @param {number} targetBytes
 * @param {number} safetyFreeBytes
 */
export function scaledSessionBytes(freeBytes, workers, targetBytes, safetyFreeBytes) {
  if (workers < 1) return 0;
  const budget = Math.max(0, freeBytes - safetyFreeBytes);
  const perWorker = Math.min(targetBytes, Math.floor(budget / workers));
  return Math.max(0, perWorker);
}
