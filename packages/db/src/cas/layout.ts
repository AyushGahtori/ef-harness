import { homedir } from "node:os";
import path from "node:path";
import { CanonicalizationError, toBareSha256Hex } from "@ef-harness/shared-contracts";
import type { CasStoredFormat } from "./types.js";

/** Ordinary GC never deletes a blob younger than this, even when it has no pin. */
export const CAS_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/** Temp spills and crash-orphaned pending pins older than this may be swept. */
export const CAS_TMP_MAX_AGE_MS = 60 * 60 * 1000;

const HASH_PATTERN = /^[0-9a-f]{64}$/;

export function normalizeCasHash(hash: string): string {
  try {
    return toBareSha256Hex(hash);
  } catch (error) {
    if (error instanceof CanonicalizationError || !HASH_PATTERN.test(hash)) {
      throw new TypeError("CAS hash must be a lowercase SHA-256 hex digest");
    }
    throw error;
  }
}

/**
 * `%LOCALAPPDATA%\EFHarness\cas\sha256\<h[0..2]>\<h[2..4]>\<hash>.zst`
 * Slice ends are exclusive, so the shard is two characters then two characters (`ab\cd`).
 */
export function blobFilePath(rootDir: string, hash: string, format: CasStoredFormat): string {
  const normalized = normalizeCasHash(hash);
  const extension = format === "raw" ? "raw" : "zst";
  return path.join(
    rootDir,
    "sha256",
    normalized.slice(0, 2),
    normalized.slice(2, 4),
    `${normalized}.${extension}`,
  );
}

export function casTempDir(rootDir: string): string {
  return path.join(rootDir, "tmp");
}

export function defaultCasRoot(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const configured = env.LOCALAPPDATA;
  const base =
    configured !== undefined && configured.length > 0
      ? configured
      : platform === "win32"
        ? path.join(env.USERPROFILE ?? homedir(), "AppData", "Local")
        : path.join(homedir(), ".local", "share");
  return path.join(base, "EFHarness", "cas");
}
