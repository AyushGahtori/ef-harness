import fs from "node:fs";
import { WindowsJobManager } from "../../src/job-objects/index.js";

const pidFile = process.argv[2];
const dbFile = process.argv[3];
const sleeper = process.argv[4];
if (!pidFile || !dbFile || !sleeper) {
  process.stderr.write("parent-exit requires pid file, database path, and sleeper script\n");
  process.exit(2);
}

const manager = new WindowsJobManager({ stateDbPath: dbFile });
const job = await manager.createJob({
  name: "parent-exit",
  kind: "project",
  limits: { memoryBytes: 512 * 1024 * 1024, activeProcessLimit: 16 },
});
await manager.spawnInJob(job, {
  file: process.execPath,
  args: [sleeper, pidFile],
  environment: "crash",
  role: "service",
});
const deadline = Date.now() + 8000;
while (!fs.existsSync(pidFile)) {
  if (Date.now() > deadline) process.exit(3);
  await new Promise((resolve) => {
    setTimeout(resolve, 20);
  });
}
process.exit(0);
