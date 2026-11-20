import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export function tempDatabaseDir(): {
  dir: string;
  file: (name: string) => string;
  cleanup: () => void;
} {
  const dir = mkdtempSync(path.join(tmpdir(), "ef-db-"));
  return {
    dir,
    file: (name: string) => path.join(dir, name),
    cleanup: () => {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        try {
          rmSync(dir, { recursive: true, force: true });
          return;
        } catch (error: unknown) {
          const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
          if (code !== "EPERM" && code !== "EBUSY" && code !== "ENOTEMPTY") throw error;
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
        }
      }
    },
  };
}

export function cell(row: unknown): unknown {
  if (row === null || row === undefined) return undefined;
  if (typeof row !== "object") return row;
  return Object.values(row)[0];
}
