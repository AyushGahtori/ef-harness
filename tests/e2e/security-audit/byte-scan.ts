import fs from "node:fs";
import path from "node:path";

export interface ByteScanHit {
  readonly file: string;
  readonly offset: number;
  readonly needle: string;
}

export function scanBytesInFile(file: string, needle: string): ByteScanHit[] {
  if (!fs.existsSync(file)) return [];
  const buf = fs.readFileSync(file);
  const hits: ByteScanHit[] = [];
  const encoded = Buffer.from(needle, "utf8");
  for (let offset = 0; offset <= buf.length - encoded.length; offset += 1) {
    if (buf.subarray(offset, offset + encoded.length).equals(encoded)) {
      hits.push({ file, offset, needle });
    }
  }
  return hits;
}

export function scanTreeBytes(root: string, needle: string, skipNames = new Set(["node_modules", "dist", "coverage", ".git"])): ByteScanHit[] {
  const hits: ByteScanHit[] = [];
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skipNames.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      hits.push(...scanBytesInFile(full, needle));
    }
  };
  walk(root);
  return hits;
}

export function scanManyNeedles(root: string, needles: readonly string[]): ByteScanHit[] {
  return needles.flatMap((needle) => scanTreeBytes(root, needle));
}