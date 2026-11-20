import path from "node:path";

/**
 * Last SHA-256 observed by a successful `read_file` for this attempt.
 * Task 056 compares a fresh hash of the file against this value and rejects
 * the edit when a developer changed the file after the worker read it.
 */
export class FileHashReadCache {
  private readonly hashes = new Map<string, string>();

  remember(realPath: string, fileHash: string): void {
    this.hashes.set(cacheKey(realPath), fileHash);
  }

  get(realPath: string): string | null {
    return this.hashes.get(cacheKey(realPath)) ?? null;
  }

  get size(): number {
    return this.hashes.size;
  }
}

function cacheKey(realPath: string): string {
  const normalized = path.normalize(realPath);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
