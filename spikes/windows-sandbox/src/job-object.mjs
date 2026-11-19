import fs from "node:fs";
import path from "node:path";
import { directSpawn } from "./spawn-direct.mjs";
import { powershellPath } from "./helper-client.mjs";
import { isPidAlive, makeScratch, removeTree, sleep, stopPid, waitUntilDead } from "./cleanup.mjs";

const sleeperSource = `import fs from "node:fs";
fs.writeFileSync(process.argv[2], String(process.pid));
setInterval(() => {}, 1000);
`;

const parentSource = `import fs from "node:fs";
import { spawn } from "node:child_process";
const signal = process.argv[2];
const ready = process.argv[3];
const out = process.argv[4];
const ps1 = process.argv[5];
const sleeper = process.argv[6];
const pidFile = process.argv[7];
const powershell = process.argv[8];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
fs.writeFileSync(ready, String(process.pid));
while (!fs.existsSync(signal)) await sleep(25);
const child = spawn(powershell, ["-NoProfile", "-NonInteractive", "-File", ps1, process.execPath, sleeper, pidFile], {
  shell: false,
  windowsHide: true,
  stdio: "ignore",
});
const started = Date.now();
while (!fs.existsSync(pidFile)) {
  if (Date.now() - started > 15000) break;
  await sleep(25);
}
const sleeperPid = fs.existsSync(pidFile) ? Number(fs.readFileSync(pidFile, "utf8")) : 0;
fs.writeFileSync(out, JSON.stringify({ pids: [process.pid, child.pid, sleeperPid] }));
setInterval(() => {}, 1000);
`;

const middleSource = `param(
  [Parameter(Mandatory = $true)][string]$Node,
  [Parameter(Mandatory = $true)][string]$Sleeper,
  [Parameter(Mandatory = $true)][string]$PidFile
)
& $Node $Sleeper $PidFile
`;

async function waitForJson(file, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (fs.existsSync(file)) {
      const text = fs.readFileSync(file, "utf8");
      if (text.trim().startsWith("{")) return JSON.parse(text);
    }
    await sleep(25);
  }
  throw new Error(`timed out waiting for ${file}`);
}

/**
 * @param {{ request: Function, kill: Function }} helper
 * @param {"close" | "crash"} mode
 */
export async function proveJobTermination(helper, mode) {
  const root = makeScratch();
  /** @type {number[]} */
  const tracked = [];
  try {
    const signal = path.join(root, "go");
    const ready = path.join(root, "ready");
    const out = path.join(root, "pids.json");
    const ps1 = path.join(root, "middle.ps1");
    const sleeper = path.join(root, "sleeper.mjs");
    const pidFile = path.join(root, "sleeper.pid");
    const parent = path.join(root, "parent.mjs");
    fs.writeFileSync(ps1, middleSource);
    fs.writeFileSync(sleeper, sleeperSource);
    fs.writeFileSync(parent, parentSource);
    const child = directSpawn(process.execPath, [
      parent,
      signal,
      ready,
      out,
      ps1,
      sleeper,
      pidFile,
      powershellPath(),
    ], { stdio: "ignore" });
    if (!child.pid) throw new Error("job tree parent did not receive a pid");
    tracked.push(child.pid);
    const readyStarted = Date.now();
    while (!fs.existsSync(ready)) {
      if (Date.now() - readyStarted > 10000) throw new Error("job tree parent did not become ready");
      await sleep(25);
    }
    const opened = await helper.request({ op: "job-open", id: `job-open-${mode}` });
    if (!opened.ok) throw new Error(`job-open failed: ${opened.detail || opened.reason}`);
    const assigned = await helper.request({ op: "job-assign", id: `job-assign-${mode}`, job: opened.job, pid: child.pid });
    if (!assigned.ok) throw new Error(`job-assign failed: ${assigned.detail || assigned.reason} win32=${assigned.win32}`);
    fs.writeFileSync(signal, "go");
    const recorded = await waitForJson(out, 15000);
    const pids = recorded.pids.filter((pid) => Number.isInteger(pid) && pid > 0);
    for (const pid of pids) tracked.push(pid);
    if (pids.length < 3) throw new Error(`expected root, powershell, and sleeper pids, got ${JSON.stringify(recorded)}`);
    const grandchild = pids[2];
    if (!isPidAlive(grandchild)) throw new Error("grandchild exited before the job handle was closed");
    const started = Date.now();
    if (mode === "close") {
      const closed = await helper.request({ op: "job-close", id: `job-close-${mode}`, job: opened.job });
      if (!closed.ok) throw new Error(`job-close failed: ${closed.detail || closed.reason}`);
    } else {
      helper.kill();
    }
    const waited = await waitUntilDead(pids, 1000);
    return {
      mode,
      pids,
      grandchild,
      elapsedMs: waited.elapsedMs,
      withinBudget: waited.alive.length === 0 && Date.now() - started <= 1000,
      orphans: waited.alive,
      killOnJobClose: true,
    };
  } finally {
    for (const pid of tracked) stopPid(pid);
    removeTree(root);
  }
}
