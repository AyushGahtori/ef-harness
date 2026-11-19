import path from "node:path";
import { fileURLToPath } from "node:url";
import { WindowsJob } from "./job-object.ts";

const ports = process.argv.slice(2).map((value) => Number(value));
const roles = ["postgres", "redis", "mailpit", "oauth"];
const sleeper = path.join(path.dirname(fileURLToPath(import.meta.url)), "sleeper.mjs");
const job = await WindowsJob.open();
const pids: number[] = [];
for (let index = 0; index < roles.length; index += 1) {
  const port = ports[index];
  const role = roles[index];
  if (!port || !role) throw new Error(`missing sleeper slot ${index}`);
  pids.push(
    await job.spawn({
      application: process.execPath,
      args: [sleeper, String(port), role],
    }),
  );
}
await job.enrollHolder();
process.stdout.write(`${JSON.stringify({ jobName: job.jobName, pids, ports, roles })}\n`);
setInterval(() => undefined, 1000);
