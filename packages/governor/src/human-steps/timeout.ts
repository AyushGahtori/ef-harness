import { HumanStepError } from "./errors.js";
import { MAX_PROBE_TIMEOUT_MS, PROBE_TIMEOUT_DIAGNOSIS } from "./types.js";

export function assertProbeTimeout(timeoutMs: number): void {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_PROBE_TIMEOUT_MS) {
    throw new HumanStepError(
      "probe_timeout_cap",
      `A probe timeout must be greater than 0 and at most ${MAX_PROBE_TIMEOUT_MS}ms`,
    );
  }
}

export function isProbeTimeoutError(error: unknown): boolean {
  return error instanceof HumanStepError && error.code === "PROBE_TIMEOUT";
}

/**
 * Race a read-only probe against a hard cap. The abort signal is how the
 * probe is killed: sockets close and child processes are terminated.
 */
export async function withProbeTimeout<T>(
  timeoutMs: number,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  assertProbeTimeout(timeoutMs);
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new HumanStepError("PROBE_TIMEOUT", PROBE_TIMEOUT_DIAGNOSIS));
    }, timeoutMs);
  });
  try {
    return await Promise.race([work(controller.signal), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
