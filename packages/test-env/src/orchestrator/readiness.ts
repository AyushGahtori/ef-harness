import {
  AppIgnoresPortError,
  ChildExitedBeforeReadyError,
  ReadinessProbeError,
  ReadinessTimeoutError,
} from "./errors.js";

export type ReadinessProbe =
  | {
      readonly type: "http";
      readonly method: "GET";
      readonly path: string;
      readonly status: number;
    }
  | { readonly type: "tcp" }
  | { readonly type: "stdout"; readonly pattern: RegExp };

export function parseReadinessProbe(ready: string): ReadinessProbe {
  const httpMatch = /^http\s+GET\s+(\S+)\s+==\s+(\d{3})$/.exec(ready.trim());
  if (httpMatch) {
    const status = Number(httpMatch[2]);
    const path = httpMatch[1];
    if (!path || !Number.isInteger(status)) {
      throw new ReadinessProbeError(`unsupported readiness probe: ${ready}`);
    }
    return { type: "http", method: "GET", path, status };
  }
  if (/^tcp$/.test(ready.trim())) {
    return { type: "tcp" };
  }
  const stdoutMatch = /^stdout\s+\/(.+)\/([a-z]*)$/.exec(ready.trim());
  if (stdoutMatch) {
    const source = stdoutMatch[1];
    const flags = stdoutMatch[2] ?? "";
    if (source === undefined) {
      throw new ReadinessProbeError(`unsupported readiness probe: ${ready}`);
    }
    return { type: "stdout", pattern: new RegExp(source, flags) };
  }
  throw new ReadinessProbeError(`unsupported readiness probe: ${ready}`);
}

export interface WaitForReadyOptions {
  readonly probe: () => Promise<boolean> | boolean;
  readonly timeoutMs: number;
  readonly intervalMs: number;
  readonly logs: () => string;
  readonly exit: Promise<{ readonly code: number | null }>;
  readonly detectIgnoredPort?: () => Promise<number | null>;
  readonly expectedPort?: number;
}

export async function waitForReady(options: WaitForReadyOptions): Promise<void> {
  const timeoutMs = options.timeoutMs;
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;

  const cleanup = () => {
    if (timer) clearTimeout(timer);
    if (interval) clearInterval(interval);
  };

  return new Promise((resolve, reject) => {
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    void options.exit.then((result) => {
      fail(new ChildExitedBeforeReadyError(result.code, options.logs()));
    });

    timer = setTimeout(() => {
      fail(new ReadinessTimeoutError(timeoutMs, options.logs()));
    }, timeoutMs);

    let polling = false;
    const poll = async () => {
      if (settled || polling) return;
      polling = true;
      try {
        if (options.detectIgnoredPort && options.expectedPort !== undefined) {
          const observed = await options.detectIgnoredPort();
          if (observed !== null && observed !== options.expectedPort) {
            fail(new AppIgnoresPortError(options.expectedPort, observed));
            return;
          }
        }
        if (await options.probe()) succeed();
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      } finally {
        polling = false;
      }
    };

    interval = setInterval(() => {
      void poll();
    }, options.intervalMs);
    void poll();
  });
}
