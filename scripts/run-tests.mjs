import { spawnSync } from "node:child_process";
import { checkoutRoot } from "./harmony-lib.mjs";

function run(command, args) {
  const result =
    process.platform === "win32" && command !== process.execPath
      ? spawnSync([command, ...args].join(" "), {
          cwd: checkoutRoot(),
          stdio: "inherit",
          windowsHide: true,
          shell: true,
        })
      : spawnSync(command, args, {
          cwd: checkoutRoot(),
          stdio: "inherit",
          windowsHide: true,
        });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
run(pnpm, ["-r", "--filter", "!ef-harness", "test"]);
run(process.execPath, ["--test", "scripts/harmony.test.mjs"]);
