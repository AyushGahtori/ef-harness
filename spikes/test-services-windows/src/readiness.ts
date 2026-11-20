import { ReadinessTimeoutError } from "./errors.ts";

export async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function waitUntilReady(options: {
  service: string;
  timeoutMs: number;
  intervalMs?: number;
  probe: () => Promise<boolean>;
  logs: () => string;
}): Promise<number> {
  const intervalMs = options.intervalMs ?? 100;
  const started = Date.now();
  let lastFailure = "";
  while (Date.now() - started <= options.timeoutMs) {
    try {
      if (await options.probe()) return Date.now() - started;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }
    await delay(intervalMs);
  }
  const logs = [options.logs(), lastFailure].filter((part) => part.length > 0).join("\n");
  throw new ReadinessTimeoutError(options.service, logs);
}
