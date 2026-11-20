import { JobObjectError, type JobKind, type JobLimits } from "./types.js";

const MAX_PROCESSES = 100_000;
const MAX_MEMORY_BYTES = 2 ** 52;

export interface LimitClampResult {
  readonly effective: JobLimits;
  readonly clamped: boolean;
  readonly notes: readonly string[];
}

export function assertJobLimits(limits: JobLimits, kind: JobKind): void {
  if (!Number.isSafeInteger(limits.memoryBytes) || limits.memoryBytes < 1) {
    throw new JobObjectError(
      "invalid_limits",
      `${kind} job memoryBytes must be a positive integer`,
    );
  }
  if (limits.memoryBytes > MAX_MEMORY_BYTES) {
    throw new JobObjectError("invalid_limits", `${kind} job memoryBytes is too large`);
  }
  if (
    !Number.isSafeInteger(limits.activeProcessLimit) ||
    limits.activeProcessLimit < 1 ||
    limits.activeProcessLimit > MAX_PROCESSES
  ) {
    throw new JobObjectError(
      "invalid_limits",
      `${kind} job activeProcessLimit must be an integer from 1 to ${MAX_PROCESSES}`,
    );
  }
  if (limits.cpuRatePercent !== undefined) {
    if (
      !Number.isSafeInteger(limits.cpuRatePercent) ||
      limits.cpuRatePercent < 1 ||
      limits.cpuRatePercent > 100
    ) {
      throw new JobObjectError(
        "invalid_limits",
        `${kind} job cpuRatePercent must be an integer from 1 to 100`,
      );
    }
  }
}

export function clampNestedLimits(child: JobLimits, parent: JobLimits | null): LimitClampResult {
  if (!parent) {
    return {
      effective: copyLimits(child.memoryBytes, child.activeProcessLimit, child.cpuRatePercent),
      clamped: false,
      notes: [],
    };
  }
  const notes: string[] = [];
  let memoryBytes = child.memoryBytes;
  let activeProcessLimit = child.activeProcessLimit;
  let cpuRatePercent = child.cpuRatePercent;
  if (memoryBytes > parent.memoryBytes) {
    notes.push(
      `memoryBytes ${memoryBytes} clamped to parent ${parent.memoryBytes}`,
    );
    memoryBytes = parent.memoryBytes;
  }
  if (activeProcessLimit > parent.activeProcessLimit) {
    notes.push(
      `activeProcessLimit ${activeProcessLimit} clamped to parent ${parent.activeProcessLimit}`,
    );
    activeProcessLimit = parent.activeProcessLimit;
  }
  if (
    parent.cpuRatePercent !== undefined &&
    cpuRatePercent !== undefined &&
    cpuRatePercent > parent.cpuRatePercent
  ) {
    notes.push(`cpuRatePercent ${cpuRatePercent} clamped to parent ${parent.cpuRatePercent}`);
    cpuRatePercent = parent.cpuRatePercent;
  } else if (parent.cpuRatePercent !== undefined && cpuRatePercent === undefined) {
    notes.push(`cpuRatePercent unset inherits parent ${parent.cpuRatePercent}`);
    cpuRatePercent = parent.cpuRatePercent;
  }
  return {
    effective: copyLimits(memoryBytes, activeProcessLimit, cpuRatePercent),
    clamped: notes.length > 0,
    notes,
  };
}

function copyLimits(
  memoryBytes: number,
  activeProcessLimit: number,
  cpuRatePercent: number | undefined,
): JobLimits {
  if (cpuRatePercent === undefined) return { memoryBytes, activeProcessLimit };
  return { memoryBytes, activeProcessLimit, cpuRatePercent };
}

export function assertTimeout(kind: JobKind, timeoutMs: number | undefined): number | null {
  if (kind === "command" || kind === "attempt") {
    if (timeoutMs === undefined || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
      throw new JobObjectError(
        "invalid_timeout",
        `${kind} jobs require a positive integer timeoutMs`,
      );
    }
    return timeoutMs;
  }
  if (timeoutMs === undefined) return null;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new JobObjectError("invalid_timeout", `${kind} job timeoutMs must be a positive integer`);
  }
  return timeoutMs;
}
