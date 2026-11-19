import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { checkoutRoot } from "./harmony-lib.mjs";

const root = checkoutRoot();
const diagram = path.join(root, "ef-harness-complete.mmd");
const before = fs.readFileSync(diagram);
const result = spawnSync(process.execPath, ["tools/merge-diagrams.js"], {
  cwd: root,
  encoding: "utf8",
  windowsHide: true,
});

if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || "merge-diagrams failed\n");
  process.exit(result.status ?? 1);
}

const after = fs.readFileSync(diagram);
if (!before.equals(after)) {
  fs.writeFileSync(diagram, before);
  process.stderr.write("tools/merge-diagrams.js changed ef-harness-complete.mmd\n");
  process.exit(1);
}

process.stdout.write(result.stdout);
