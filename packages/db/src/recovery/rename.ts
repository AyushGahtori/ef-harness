import fs from "node:fs";
import path from "node:path";
import { renameRetryDelays, type Sleeper } from "./clock.js";
import { errorMessage } from "./sqlite-io.js";
import { RecoveryError } from "./types.js";

export type RenameFn = (from: string, to: string) => void;

function isRetryableFsError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === "EPERM" || code === "EBUSY" || code === "EACCES";
}

/**
 * Windows antivirus and indexers briefly lock files being renamed.
 * Try 10 times, backing off from 50 ms to 1 s.
 */
export async function renameWithRetry(
  from: string,
  to: string,
  sleeper: Sleeper,
  rename: RenameFn = fs.renameSync,
): Promise<void> {
  const delays = renameRetryDelays();
  let lastError: unknown;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      rename(from, to);
      return;
    } catch (error) {
      lastError = error;
      if (!isRetryableFsError(error) || attempt === 9) break;
      await sleeper.sleep(delays[attempt] ?? 1000);
    }
  }
  throw new RecoveryError(
    "rename_failed",
    `Failed to rename ${from} to ${to} after 10 attempts: ${errorMessage(lastError)}`,
  );
}

export async function moveOptionalFile(
  from: string,
  to: string,
  sleeper: Sleeper,
): Promise<boolean> {
  if (!fs.existsSync(from)) return false;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  await renameWithRetry(from, to, sleeper);
  return true;
}
