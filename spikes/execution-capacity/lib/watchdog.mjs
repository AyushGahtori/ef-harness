import fs from "node:fs";
import { pidAlive, sleep } from "./spawn.mjs";

const parent = Number(process.argv[2]);
const stateFile = process.argv[3];
if (!Number.isInteger(parent) || !stateFile) {
  process.exit(2);
}

async function tick() {
  let state = { done: false, scratch: "", pids: [] };
  try {
    state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch {
    return;
  }
  if (state.done) process.exit(0);
  if (pidAlive(parent)) return;
  for (const pid of state.pids ?? []) {
    if (pid === process.pid) continue;
    if (pidAlive(pid)) {
      try {
        process.kill(pid);
      } catch {
        // Already gone.
      }
    }
  }
  if (state.scratch) fs.rmSync(state.scratch, { recursive: true, force: true });
  process.exit(0);
}

while (pidAlive(parent)) {
  await sleep(200);
  await tick();
}
await tick();
