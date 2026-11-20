import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ReadModelProfile } from "../../src/read-tools/index.js";

export function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function writeFile(root: string, relativePath: string, content: string | Buffer): string {
  const full = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

export function largeProfile(contextWindow = 128_000): ReadModelProfile {
  return { contextWindow };
}

export function smallProfile(contextWindow = 32_768): ReadModelProfile {
  return { contextWindow };
}

export function snapshotTree(root: string): Map<string, string> {
  const hashes = new Map<string, string>();
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(full);
        continue;
      }
      if (!entry.isFile()) continue;
      hashes.set(path.relative(root, full), fs.readFileSync(full).toString("base64"));
    }
  };
  visit(root);
  return hashes;
}

export function joined(parts: readonly string[]): string {
  return parts.join("");
}
