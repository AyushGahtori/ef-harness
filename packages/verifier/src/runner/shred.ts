import { closeSync, existsSync, ftruncateSync, openSync, readdirSync, rmdirSync, statSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";

/** Overwrite then unlink so a crash between the two still leaves zeros, not plaintext. */
export function shredFile(file: string): void {
  if (!existsSync(file)) return;
  const size = statSync(file).size;
  const fd = openSync(file, "r+");
  try {
    const zeros = Buffer.alloc(Math.max(size, 1));
    writeSync(fd, zeros, 0, zeros.length, 0);
    ftruncateSync(fd, 0);
  } finally {
    closeSync(fd);
  }
  unlinkSync(file);
}

export function shredTree(dir: string): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      shredTree(full);
    } else {
      shredFile(full);
    }
  }
  rmdirSync(dir);
}
