import fs from "node:fs";
import path from "node:path";
import type { StoreAlignment } from "./types.js";

export class DiskLane {
  private tail: Promise<void> = Promise.resolve();

  run<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work, work);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export const sharedDiskLane = new DiskLane();

export function volumeKey(filePath: string, volumeOf?: (filePath: string) => string): string {
  if (volumeOf) return volumeOf(filePath);
  const resolved = path.resolve(filePath);
  const unc = /^\\\\[^\\]+\\[^\\]+/.exec(resolved);
  if (unc?.[0]) return unc[0].toUpperCase();
  const drive = /^[A-Za-z]:/.exec(resolved);
  if (drive?.[0]) return drive[0].toUpperCase();
  return `posix:${path.parse(resolved).root}`;
}

export function alignStoreWithWorktree(input: {
  readonly worktreePath: string;
  readonly storeDir: string;
  readonly volumeOf?: (filePath: string) => string;
}): StoreAlignment {
  const workKey = volumeKey(input.worktreePath, input.volumeOf);
  const storeKey = volumeKey(input.storeDir, input.volumeOf);
  if (workKey === storeKey) {
    return { storeDir: path.resolve(input.storeDir), realigned: false, warning: null };
  }
  const storeDir = /^[A-Za-z]:$/.test(workKey)
    ? path.win32.join(`${workKey}\\`, "EFHarness", "pnpm-store")
    : path.join(input.worktreePath, ".ef-harness", "pnpm-store");
  return {
    storeDir,
    realigned: true,
    warning: `pnpm store volume ${storeKey} differs from worktree volume ${workKey}. Hard links would fall back to full file copies, so the store was moved to ${storeDir}.`,
  };
}

export function ensureStoreDirectory(storeDir: string): void {
  const root = path.parse(path.resolve(storeDir)).root;
  if (!root || !fs.existsSync(root)) return;
  fs.mkdirSync(storeDir, { recursive: true });
}

function integrityFileName(integrity: string): string {
  return integrity.replace(/[^A-Za-z0-9]/g, "_");
}

export function storeHasIntegrity(storeDir: string, integrity: string): boolean {
  const fileName = integrityFileName(integrity);
  return (
    fs.existsSync(path.join(storeDir, "index", fileName)) ||
    fs.existsSync(path.join(storeDir, "v10", fileName))
  );
}

export function markNodeModulesReadOnly(nodeModulesPath: string): number {
  if (!fs.existsSync(nodeModulesPath)) return 0;
  let count = 0;
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        fs.chmodSync(full, 0o555);
        count += 1;
      } else if (entry.isFile()) {
        fs.chmodSync(full, 0o444);
        count += 1;
      }
    }
  };
  walk(nodeModulesPath);
  fs.chmodSync(nodeModulesPath, 0o555);
  count += 1;
  return count;
}

export function chmodWritable(directory: string): void {
  if (!fs.existsSync(directory)) return;
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      fs.chmodSync(full, entry.isDirectory() ? 0o755 : 0o644);
    }
  };
  fs.chmodSync(directory, 0o755);
  walk(directory);
}
