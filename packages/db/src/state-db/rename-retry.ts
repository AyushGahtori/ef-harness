import fs from "node:fs";
import { RENAME_DELAYS_MS } from "./constants.js";

export interface RenameHooks {
  rename?: (from: string, to: string) => void;
  sleep?: (milliseconds: number) => void;
}

export function renameWithRetry(from: string, to: string, hooks?: RenameHooks): void {
  const rename = hooks?.rename ?? fs.renameSync;
  const sleep = hooks?.sleep ?? sleepMs;
  let lastError: unknown;
  for (let attempt = 0; attempt < RENAME_DELAYS_MS.length; attempt += 1) {
    try {
      rename(from, to);
      return;
    } catch (error) {
      lastError = error;
      const delay = RENAME_DELAYS_MS[attempt];
      const canRetry = attempt < RENAME_DELAYS_MS.length - 1 && delay !== undefined;
      if (!isRetryableRenameError(error) || !canRetry) throw error;
      sleep(delay);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("rename failed");
}

export function sleepMs(milliseconds: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    void reason;
    spinWait(milliseconds);
  }
}

export function isRetryableRenameError(error: unknown): boolean {
  const code = errorCode(error);
  return code === "EPERM" || code === "EBUSY" || code === "EACCES";
}

function spinWait(milliseconds: number): void {
  const end = Date.now() + milliseconds;
  let now = Date.now();
  while (now < end) {
    now = Date.now();
  }
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = error.code;
  return typeof code === "string" ? code : undefined;
}
