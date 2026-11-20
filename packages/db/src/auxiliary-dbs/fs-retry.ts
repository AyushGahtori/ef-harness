import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

const RETRY_DELAYS_MS = [0, 20, 50, 100, 150, 250, 400, 600, 800, 1000];

export function sleepSync(ms: number): void {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isRetryableFsError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  const code = (error as { code: unknown }).code;
  return code === "EPERM" || code === "EACCES" || code === "EBUSY" || code === "ENOTEMPTY";
}

export function renameWithRetry(from: string, to: string): void {
  let last: unknown;
  for (const delay of RETRY_DELAYS_MS) {
    sleepSync(delay);
    try {
      fs.renameSync(from, to);
      return;
    } catch (error) {
      last = error;
      if (!isRetryableFsError(error)) throw error;
    }
  }
  throw last;
}

export function removeWithRetry(target: string): void {
  let last: unknown;
  for (const delay of RETRY_DELAYS_MS) {
    sleepSync(delay);
    try {
      fs.rmSync(target, { recursive: true, force: true });
      return;
    } catch (error) {
      last = error;
      if (!isRetryableFsError(error)) throw error;
    }
  }
  throw last;
}

export function quarantineDatabaseFile(filePath: string): string {
  const directory = path.dirname(filePath);
  const quarantineDir = path.join(directory, "quarantine");
  fs.mkdirSync(quarantineDir, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const destination = path.join(
    quarantineDir,
    `${path.basename(filePath)}.${stamp}.${process.pid}.${randomBytes(3).toString("hex")}`,
  );
  renameWithRetry(filePath, destination);
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    const sidecar = `${filePath}${suffix}`;
    if (!fs.existsSync(sidecar)) continue;
    renameWithRetry(sidecar, `${destination}${suffix}`);
  }
  return destination;
}
