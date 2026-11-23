import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export function repoRoot() {
  return path.resolve(here, "..", "..", "..");
}

export function desktopBuildRoot() {
  return path.join(repoRoot(), "apps", "desktop", "build");
}

export function fixturesRoot() {
  return path.join(desktopBuildRoot(), "fixtures");
}

export function defaultOutputRoot() {
  return path.join(desktopBuildRoot(), "dist");
}

export function winUnpackedDir(outputRoot = defaultOutputRoot()) {
  return path.join(outputRoot, "win-unpacked");
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function walkFiles(rootDir, filter = () => true) {
  const out = [];
  if (!fs.existsSync(rootDir)) return out;
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const full = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full, filter));
    } else if (entry.isFile() && filter(full)) {
      out.push(full);
    }
  }
  return out;
}