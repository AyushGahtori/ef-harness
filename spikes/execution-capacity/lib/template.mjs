import fs from "node:fs";
import path from "node:path";
import { spikeRoot } from "./paths.mjs";

const templateRoot = path.join(spikeRoot(), "template-app");

/**
 * Copy the tiny template into a scratch slot and hard-link the shared store file.
 * package.json and tsconfig.json are written only in scratch; those names are
 * frozen in the git tree by Task 001.
 * @param {string} slotDir
 * @param {string} storeFile
 */
export function materializeSlot(slotDir, storeFile) {
  fs.mkdirSync(slotDir, { recursive: true });
  copyTree(path.join(templateRoot, "src"), path.join(slotDir, "src"));
  fs.copyFileSync(path.join(templateRoot, "index.html"), path.join(slotDir, "index.html"));
  fs.copyFileSync(path.join(templateRoot, "vite.config.mjs"), path.join(slotDir, "vite.config.mjs"));
  fs.copyFileSync(path.join(templateRoot, "app.manifest.json"), path.join(slotDir, "package.json"));
  fs.copyFileSync(path.join(templateRoot, "app.tsconfig.json"), path.join(slotDir, "tsconfig.json"));
  const linked = path.join(slotDir, "node_modules", "capacity-store", "index.js");
  fs.mkdirSync(path.dirname(linked), { recursive: true });
  try {
    fs.linkSync(storeFile, linked);
  } catch {
    fs.copyFileSync(storeFile, linked);
  }
  return { slotDir, linked };
}

/**
 * @param {string} scratch
 */
export function createSharedStore(scratch) {
  const storeFile = path.join(scratch, "pnpm-store", "capacity-store", "index.js");
  fs.mkdirSync(path.dirname(storeFile), { recursive: true });
  fs.copyFileSync(path.join(templateRoot, "store-package", "index.js"), storeFile);
  return storeFile;
}

/**
 * @param {string} from
 * @param {string} to
 */
function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(source, target);
    else fs.copyFileSync(source, target);
  }
}

/**
 * @param {string} filePath
 */
export function directoryBytes(filePath) {
  if (!fs.existsSync(filePath)) return 0;
  const stat = fs.statSync(filePath);
  if (stat.isFile()) return stat.size;
  let total = 0;
  for (const entry of fs.readdirSync(filePath, { withFileTypes: true })) {
    total += directoryBytes(path.join(filePath, entry.name));
  }
  return total;
}
