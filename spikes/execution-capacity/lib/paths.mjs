import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export function spikeRoot() {
  return path.resolve(here, "..");
}

export function repoRoot() {
  let dir = spikeRoot();
  while (true) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error("pnpm-workspace.yaml was not found above the spike");
    }
    dir = parent;
  }
}

/**
 * @param {string} start
 * @param {string} relative
 */
function walkFor(start, relative) {
  let dir = start;
  while (true) {
    const candidate = path.join(dir, relative);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function tscPath() {
  const found = walkFor(repoRoot(), path.join("node_modules", "typescript", "lib", "tsc.js"));
  if (!found) throw new Error("typescript lib/tsc.js is not installed in the workspace");
  return found;
}

export function viteBin() {
  const pnpmDir = path.join(repoRoot(), "node_modules", ".pnpm");
  if (!fs.existsSync(pnpmDir)) return null;
  const entry = fs.readdirSync(pnpmDir).find((name) => name.startsWith("vite@"));
  if (!entry) return null;
  const bin = path.join(pnpmDir, entry, "node_modules", "vite", "bin", "vite.js");
  return fs.existsSync(bin) ? bin : null;
}

export function pnpmEntry() {
  const candidates = [
    process.env.EF_PNPM_ENTRY,
    process.env.APPDATA ? path.join(process.env.APPDATA, "npm", "node_modules", "pnpm", "bin", "pnpm.cjs") : null,
    walkFor(repoRoot(), path.join("node_modules", "pnpm", "bin", "pnpm.cjs")),
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function electronExe() {
  const found = walkFor(repoRoot(), path.join("node_modules", "electron", "dist", "electron.exe"));
  if (found) return found;
  const pathFile = walkFor(repoRoot(), path.join("node_modules", "electron", "path.txt"));
  if (!pathFile) return null;
  const relative = fs.readFileSync(pathFile, "utf8").trim();
  const exe = path.join(path.dirname(pathFile), "dist", relative);
  return fs.existsSync(exe) ? exe : null;
}
