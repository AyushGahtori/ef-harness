import { randomBytes } from "node:crypto";
import { access, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { errorCode } from "./fs-error.js";

export const ATOMIC_RENAME_ATTEMPTS = 5;

export interface AtomicWriteOptions {
  readonly maxAttempts?: number;
  readonly nonce?: string;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly backoff?: (attempt: number) => number;
  readonly rename?: (from: string, to: string) => Promise<void>;
}

export interface AtomicWriteSuccess {
  readonly ok: true;
  readonly attempts: number;
  readonly target: string;
}

export interface AtomicWriteDeferred {
  readonly ok: false;
  readonly attempts: number;
  readonly code: string;
  readonly diagnostic: string;
  readonly target: string;
}

export type AtomicWriteResult = AtomicWriteSuccess | AtomicWriteDeferred;

export function retryDelayMs(attempt: number, random: () => number = Math.random): number {
  const exponent = Math.max(0, attempt - 1);
  const base = 10 * 2 ** exponent;
  const jitter = Math.floor(random() * base);
  return base + jitter;
}

export async function delay(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Write the full payload to `.tmp.<pid>.<nonce>` in the destination directory,
 * then rename it into place. Locked files (EBUSY / EPERM / EACCES) retry with
 * bounded exponential jitter. The previous file is left intact when every attempt fails.
 */
export async function atomicWriteFile(
  target: string,
  content: string,
  options: AtomicWriteOptions = {},
): Promise<AtomicWriteResult> {
  const maxAttempts = options.maxAttempts ?? ATOMIC_RENAME_ATTEMPTS;
  const sleep = options.sleep ?? delay;
  const backoff = options.backoff ?? ((attempt: number) => retryDelayMs(attempt));
  const renameFile = options.rename ?? renameReplacing;
  const nonce = options.nonce ?? randomBytes(6).toString("hex");
  await mkdir(path.dirname(target), { recursive: true });
  const extension = path.extname(target);
  const tmp = path.join(path.dirname(target), `.tmp.${String(process.pid)}.${nonce}${extension || ".txt"}`);
  await writeFile(tmp, content, "utf8");
  let lastCode = "EPERM";
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await renameFile(tmp, target);
      return { ok: true, attempts: attempt, target };
    } catch (error) {
      lastCode = errorCode(error) ?? "EIO";
      const locked = lastCode === "EBUSY" || lastCode === "EPERM" || lastCode === "EACCES";
      if (!locked || attempt === maxAttempts) {
        await rm(tmp, { force: true });
        return {
          ok: false,
          attempts: attempt,
          code: lastCode,
          target,
          diagnostic: `deferred write of ${target}: ${locked ? "file locked" : "rename failed"} after ${String(attempt)} attempts (${lastCode})`,
        };
      }
      await sleep(backoff(attempt));
    }
  }
  await rm(tmp, { force: true });
  return {
    ok: false,
    attempts: maxAttempts,
    code: lastCode,
    target,
    diagnostic: `deferred write of ${target}: file locked after ${String(maxAttempts)} attempts (${lastCode})`,
  };
}

export async function renameReplacing(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
    return;
  } catch (error) {
    const code = errorCode(error);
    const exists = await fileExists(to);
    if (!exists || (code !== "EPERM" && code !== "EEXIST" && code !== "EACCES")) throw error;
    const backup = `${from}.bak`;
    await rename(to, backup);
    try {
      await rename(from, to);
    } catch (placeError) {
      try {
        await rename(backup, to);
      } catch {
        throw placeError;
      }
      throw placeError;
    }
    await rm(backup, { force: true });
  }
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
