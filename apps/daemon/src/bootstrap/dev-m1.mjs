// Integrator wires this file as the root script `pnpm dev:m1`.
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const require = createRequire(path.join(root, "package.json"));
const pnpm = "pnpm";

function run(args) {
  const result = spawnSync(pnpm, args, { cwd: root, stdio: "inherit", shell: true, windowsHide: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(["--filter", "@ef-harness/daemon", "typecheck"]);
run(["--filter", "@ef-harness/desktop", "typecheck"]);

const electron = require("electron");
if (typeof electron !== "string") {
  console.error("The electron package did not resolve to an executable path.");
  process.exit(1);
}

const entry = path.join(root, "apps", "desktop", "dist", "bootstrap", "electron-entry.js");
const child = spawn(electron, [entry], {
  cwd: root,
  stdio: "inherit",
  windowsHide: true,
  env: { ...process.env, EF_HARNESS_SIM_TASK: process.env.EF_HARNESS_SIM_TASK ?? "1" },
});
child.on("exit", (code) => {
  process.exit(code ?? 0);
});
