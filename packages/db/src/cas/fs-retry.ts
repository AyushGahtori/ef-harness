import { setTimeout as delay } from "node:timers/promises";
import { access, chmod } from "node:fs/promises";

export const CAS_RENAME_ATTEMPTS = 10;
export const CAS_RENAME_BACKOFF_START_MS = 50;
export const CAS_RENAME_BACKOFF_CAP_MS = 1000;

/** Delay after a failed attempt. Attempt 1 waits 50 ms; the delay doubles up to 1 s. */
export function casRenameBackoffMs(failedAttempt: number): number {
  if (!Number.isInteger(failedAttempt) || failedAttempt < 1) {
    throw new TypeError("failedAttempt must be a positive integer");
  }
  const grew = CAS_RENAME_BACKOFF_START_MS * 2 ** (failedAttempt - 1);
  return Math.min(CAS_RENAME_BACKOFF_CAP_MS, grew);
}

export function defaultSleep(ms: number): Promise<void> {
  return delay(ms);
}

export function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export function isRetryableFsError(error: unknown): boolean {
  const code = errorCode(error);
  return code === "EPERM" || code === "EBUSY" || code === "EACCES";
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}

export class CasTargetExistsError extends Error {
  readonly code = "EEXIST" as const;

  constructor(targetPath: string, cause?: unknown) {
    super(
      `CAS target already exists: ${targetPath}`,
      cause === undefined ? undefined : { cause },
    );
    this.name = "CasTargetExistsError";
  }
}

export async function renameWithRetry(
  from: string,
  to: string,
  rename: (from: string, to: string) => Promise<void>,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= CAS_RENAME_ATTEMPTS; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      lastError = error;
      if (await pathExists(to)) {
        throw new CasTargetExistsError(to, error);
      }
      if (!isRetryableFsError(error) || attempt === CAS_RENAME_ATTEMPTS) {
        throw error;
      }
      await sleep(casRenameBackoffMs(attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("CAS rename failed");
}

export async function chmodWithRetry(
  filePath: string,
  mode: number,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  for (let attempt = 1; attempt <= CAS_RENAME_ATTEMPTS; attempt += 1) {
    try {
      await chmod(filePath, mode);
      return;
    } catch (error) {
      if (errorCode(error) === "ENOENT") throw error;
      if (!isRetryableFsError(error) || attempt === CAS_RENAME_ATTEMPTS) throw error;
      await sleep(casRenameBackoffMs(attempt));
    }
  }
}

export async function unlinkWithRetry(
  filePath: string,
  unlink: (filePath: string) => Promise<void>,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  for (let attempt = 1; attempt <= CAS_RENAME_ATTEMPTS; attempt += 1) {
    try {
      await unlink(filePath);
      return;
    } catch (error) {
      if (errorCode(error) === "ENOENT") return;
      if (!isRetryableFsError(error) || attempt === CAS_RENAME_ATTEMPTS) throw error;
      await sleep(casRenameBackoffMs(attempt));
    }
  }
}
