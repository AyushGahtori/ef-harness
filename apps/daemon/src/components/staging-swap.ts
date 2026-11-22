import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";

export type InterruptedInstallRecovery = "restored" | "clean" | "absent";

/**
 * Swap a fully verified staging directory into place.
 * A crash after the live tree is moved aside is repaired by `recoverInterruptedInstall`.
 */
export function atomicDirectorySwap(
  stagingDir: string,
  liveDir: string,
  hooks?: { afterMoveLiveAside?: () => void },
): void {
  const previous = `${liveDir}.previous`;
  rmSync(previous, { recursive: true, force: true });
  if (existsSync(liveDir)) renameSync(liveDir, previous);
  try {
    hooks?.afterMoveLiveAside?.();
    renameSync(stagingDir, liveDir);
  } catch (error) {
    if (!existsSync(liveDir) && existsSync(previous)) renameSync(previous, liveDir);
    throw error;
  }
  rmSync(previous, { recursive: true, force: true });
}

export function recoverInterruptedInstall(liveDir: string): InterruptedInstallRecovery {
  const previous = `${liveDir}.previous`;
  const staging = `${liveDir}.staging`;
  if (!existsSync(liveDir) && existsSync(previous)) {
    renameSync(previous, liveDir);
    if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
    return "restored";
  }
  if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
  return existsSync(liveDir) ? "clean" : "absent";
}

export function ensureEmptyDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}
