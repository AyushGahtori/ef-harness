import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vitest = path.join(packageRoot, "node_modules", "vitest", "vitest.mjs");
const child = spawn(
  process.execPath,
  [
    vitest,
    "run",
    "--config",
    path.join(path.dirname(fileURLToPath(import.meta.url)), "vitest.spike.config.mjs"),
    "test-services-windows",
  ],
  { cwd: packageRoot, stdio: "inherit", windowsHide: true, shell: false },
);
child.on("exit", (code) => {
  process.exit(code ?? 1);
});
