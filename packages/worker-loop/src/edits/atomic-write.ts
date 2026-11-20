import fs from "node:fs";
import path from "node:path";

export interface AtomicFs {
  writeFileSync(file: string, data: string): void;
  renameSync(from: string, to: string): void;
  rmSync(file: string): void;
  existsSync(file: string): boolean;
  mkdirSync(dir: string): void;
}

const nodeAtomicFs: AtomicFs = {
  writeFileSync(file, data) {
    fs.writeFileSync(file, data);
  },
  renameSync(from, to) {
    fs.renameSync(from, to);
  },
  rmSync(file) {
    fs.rmSync(file, { force: true });
  },
  existsSync(file) {
    return fs.existsSync(file);
  },
  mkdirSync(dir) {
    fs.mkdirSync(dir, { recursive: true });
  },
};

const DEFAULT_RETRY_DELAYS_MS = [0, 15, 40, 80, 160] as const;

let tempSequence = 0;

function sleepMs(ms: number): void {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isRetryable(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  const code = String(error.code);
  return code === "EPERM" || code === "EBUSY";
}

function retrySync(action: () => void, delays: readonly number[]): void {
  let last: unknown;
  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    const delay = delays[attempt] ?? 0;
    if (delay > 0) sleepMs(delay);
    try {
      action();
      return;
    } catch (error) {
      last = error;
      if (!isRetryable(error) || attempt === delays.length - 1) throw error;
    }
  }
  throw last;
}

function tempSibling(target: string, suffix: string): string {
  tempSequence += 1;
  const dir = path.dirname(target);
  const base = path.basename(target);
  return path.join(dir, `.${base}.${process.pid}.${tempSequence}.${suffix}`);
}

export interface AtomicWriteOptions {
  readonly fs?: AtomicFs;
  readonly retryDelaysMs?: readonly number[];
}

/**
 * Write the full payload to a temp sibling, then rename it into place.
 * Windows `EPERM` / `EBUSY` renames are retried. The target is never truncated
 * in place, so a crash cannot leave a half-written 0-byte source file.
 */
export function atomicWriteFile(target: string, content: string, options: AtomicWriteOptions = {}): void {
  const io = options.fs ?? nodeAtomicFs;
  const delays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  io.mkdirSync(path.dirname(target));
  const temp = tempSibling(target, "ef-tmp");
  const backup = tempSibling(target, "ef-bak");
  io.writeFileSync(temp, content);
  let movedAside = false;
  try {
    if (io.existsSync(target)) {
      retrySync(() => io.renameSync(target, backup), delays);
      movedAside = true;
    }
    retrySync(() => io.renameSync(temp, target), delays);
    if (movedAside && io.existsSync(backup)) {
      try {
        io.rmSync(backup);
      } catch (cleanupError) {
        void cleanupError;
      }
    }
  } catch (error) {
    if (io.existsSync(temp)) {
      try {
        io.rmSync(temp);
      } catch (cleanupError) {
        void cleanupError;
      }
    }
    if (movedAside && io.existsSync(backup) && !io.existsSync(target)) {
      try {
        io.renameSync(backup, target);
      } catch (cleanupError) {
        void cleanupError;
      }
    }
    throw error;
  }
}

export function atomicRemoveFile(target: string, retryDelaysMs: readonly number[] = DEFAULT_RETRY_DELAYS_MS): void {
  retrySync(() => fs.rmSync(target, { force: false }), retryDelaysMs);
}
