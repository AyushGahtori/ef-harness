import { spawn } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const pidFile = process.argv[2];
if (!pidFile) {
  process.stderr.write("missing pid file\n");
  process.exit(2);
}

const leaf = fileURLToPath(new URL("./hang-leaf.mjs", import.meta.url));
let child = null;
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  if (!buffer.includes("go\n") || child) return;
  child = spawn(process.execPath, [leaf], {
    shell: false,
    windowsHide: true,
    stdio: "ignore",
  });
  fs.writeFileSync(pidFile, `${process.pid}\n${child.pid}\n`);
});
process.stdout.write("ready\n");
setInterval(() => {}, 1000);
