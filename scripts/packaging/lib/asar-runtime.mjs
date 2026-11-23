import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "./paths.mjs";

function resolveAsarPackageJson() {
  const direct = path.join(repoRoot(), "node_modules", "@electron", "asar", "package.json");
  if (fs.existsSync(direct)) return direct;
  const pnpmRoot = path.join(repoRoot(), "node_modules", ".pnpm");
  if (!fs.existsSync(pnpmRoot)) {
    throw new Error("@electron/asar is not installed");
  }
  for (const entry of fs.readdirSync(pnpmRoot)) {
    if (!entry.startsWith("@electron+asar@")) continue;
    const candidate = path.join(pnpmRoot, entry, "node_modules", "@electron", "asar", "package.json");
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error("@electron/asar is not installed");
}

const require = createRequire(resolveAsarPackageJson());
const asar = require("./lib/asar");

export default asar;