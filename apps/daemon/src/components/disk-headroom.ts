import { statfsSync } from "node:fs";
import { InsufficientDiskHeadroomError } from "./errors.js";

/** Decimal 5 GB, matching `freeBytes - 2 * size >= 5 GB`. */
export const COMPONENT_DOWNLOAD_RESERVE_BYTES = 5_000_000_000n;

export function remainingDownloadHeadroom(freeBytes: bigint, componentSizeBytes: bigint): bigint {
  return freeBytes - 2n * componentSizeBytes;
}

export function componentDownloadFits(freeBytes: bigint, componentSizeBytes: bigint): boolean {
  return remainingDownloadHeadroom(freeBytes, componentSizeBytes) >= COMPONENT_DOWNLOAD_RESERVE_BYTES;
}

/**
 * Local port for Task 118 `DiskHeadroomGuard`.
 * Swap for the real export when that branch is integrated.
 */
export interface DiskHeadroomGuardPort {
  freeBytes(targetDirectory: string): bigint | Promise<bigint>;
}

export const nodeDiskHeadroomGuard: DiskHeadroomGuardPort = {
  freeBytes(targetDirectory: string): bigint {
    const stats = statfsSync(targetDirectory);
    return BigInt(stats.bavail) * BigInt(stats.bsize);
  },
};

export async function assertComponentDownloadHeadroom(
  guard: DiskHeadroomGuardPort,
  targetDirectory: string,
  componentSizeBytes: number,
): Promise<void> {
  const freeBytes = await guard.freeBytes(targetDirectory);
  const size = BigInt(componentSizeBytes);
  if (!componentDownloadFits(freeBytes, size)) {
    throw new InsufficientDiskHeadroomError(freeBytes, size);
  }
}
