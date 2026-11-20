import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function makeTempRoot(name: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `ef-014-${name}-`));
}

export function removeTempRoot(root: string): void {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = error instanceof Error && "code" in error ? (error as { code?: string }).code : undefined;
      if (code !== "EBUSY" && code !== "EPERM" && code !== "ENOTEMPTY") throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40 * (attempt + 1));
    }
  }
  fs.rmSync(root, { recursive: true, force: true });
}

export function projectPath(name: string): string {
  if (process.platform === "win32") return `C:\\EFHarnessProjects\\${name}`;
  return `/var/ef-harness-projects/${name}`;
}

export function corruptHeader(filePath: string): void {
  const bytes = fs.readFileSync(filePath);
  bytes.fill(0, 0, Math.min(16, bytes.length));
  fs.writeFileSync(filePath, bytes);
}
