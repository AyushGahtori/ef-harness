import { Worker } from "node:worker_threads";

const HEADER = 16;
const STATE = 0;
const LENGTH = 1;
const READY = 2;
const IDLE = 0;
const REQUEST = 1;
const RESPONSE = 2;

const POWERSHELL_SCRIPT = [
  "Add-Type @'",
  "using System;",
  "using System.Collections.Generic;",
  "using System.Runtime.InteropServices;",
  "public static class EfHarnessJob {",
  '  [DllImport("kernel32", SetLastError=true)] public static extern IntPtr CreateJobObject(IntPtr attr, string name);',
  '  [DllImport("kernel32", SetLastError=true)] public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);',
  '  [DllImport("kernel32", SetLastError=true)] public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);',
  '  [DllImport("kernel32", SetLastError=true)] public static extern bool TerminateJobObject(IntPtr job, uint code);',
  '  [DllImport("kernel32", SetLastError=true)] public static extern bool CloseHandle(IntPtr handle);',
  "  static Dictionary<string, IntPtr> jobs = new Dictionary<string, IntPtr>();",
  "  public static string Assign(string id, int processId) {",
  "    IntPtr job;",
  "    if (!jobs.TryGetValue(id, out job) || job == IntPtr.Zero) {",
  "      job = CreateJobObject(IntPtr.Zero, null);",
  '      if (job == IntPtr.Zero) return "ERR create";',
  "      jobs[id] = job;",
  "    }",
  "    IntPtr process = OpenProcess(0x1F0FFF, false, processId);",
  '    if (process == IntPtr.Zero) return "ERR open";',
  "    bool ok = AssignProcessToJobObject(job, process);",
  "    CloseHandle(process);",
  '    return ok ? "OK" : "ERR assign";',
  "  }",
  "  public static string Kill(string id) {",
  "    IntPtr job;",
  '    if (!jobs.TryGetValue(id, out job)) return "ERR missing";',
  '    return TerminateJobObject(job, 1) ? "OK" : "ERR terminate";',
  "  }",
  "}",
  "'@",
  '[Console]::Out.WriteLine("READY")',
  "[Console]::Out.Flush()",
  "while ($true) {",
  "  $line = [Console]::In.ReadLine()",
  "  if ($null -eq $line -or $line.Length -eq 0) { continue }",
  '  $parts = $line.Split(" ", 3)',
  "  $kind = $parts[0]",
  "  $id = $parts[1]",
  '  if ($kind -eq "ASSIGN") { [Console]::Out.WriteLine([EfHarnessJob]::Assign($id, [int]$parts[2])) }',
  '  elseif ($kind -eq "KILL") { [Console]::Out.WriteLine([EfHarnessJob]::Kill($id)) }',
  '  else { [Console]::Out.WriteLine("ERR command") }',
  "  [Console]::Out.Flush()",
  "}",
].join("\n");

const WORKER_SOURCE = `
const { spawn } = require("node:child_process");
const { workerData } = require("node:worker_threads");
const view = new Int32Array(workerData.sab);
const bytes = new Uint8Array(workerData.sab);
const helper = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", workerData.script], {
  stdio: ["pipe", "pipe", "ignore"],
  windowsHide: true,
});
helper.unref();
let buffer = "";
const lines = [];
const pending = [];
helper.stdout.setEncoding("utf8");
helper.stdout.on("data", (chunk) => {
  buffer += chunk;
  let index = buffer.indexOf("\\n");
  while (index >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    const waiter = pending.shift();
    if (waiter) waiter(line);
    else if (line.length > 0) lines.push(line);
    index = buffer.indexOf("\\n");
  }
});
function nextLine() {
  const queued = lines.shift();
  if (queued !== undefined) return Promise.resolve(queued);
  return new Promise((resolve) => pending.push(resolve));
}
function send(command) {
  helper.stdin.write(command + "\\n");
  return nextLine();
}
function readCommand() {
  const length = Atomics.load(view, ${LENGTH});
  return Buffer.from(bytes.slice(${HEADER}, ${HEADER} + length)).toString("utf8");
}
function writeResponse(text) {
  const encoded = Buffer.from(text, "utf8");
  bytes.set(encoded, ${HEADER});
  Atomics.store(view, ${LENGTH}, encoded.length);
}
(async () => {
  const ready = await nextLine();
  if (ready !== "READY") return;
  Atomics.store(view, ${READY}, 1);
  Atomics.notify(view, ${READY});
  for (;;) {
    const state = Atomics.load(view, ${STATE});
    if (state !== ${REQUEST}) {
      Atomics.wait(view, ${STATE}, state);
      continue;
    }
    const reply = await send(readCommand());
    writeResponse(reply);
    Atomics.store(view, ${STATE}, ${RESPONSE});
    Atomics.notify(view, ${STATE});
  }
})();
`;

let sab: SharedArrayBuffer | null = null;
let view: Int32Array | null = null;
let worker: Worker | null = null;
let ready = false;

function ensureHelper(): boolean {
  if (process.platform !== "win32") return false;
  if (ready && view) return true;
  if (!sab || !view || !worker) {
    sab = new SharedArrayBuffer(HEADER + 8192);
    view = new Int32Array(sab);
    worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { sab, script: POWERSHELL_SCRIPT },
    });
    worker.unref();
    worker.on("error", () => {
      ready = false;
    });
  }
  const status = Atomics.wait(view, READY, 0, 20_000);
  ready = status !== "timed-out" && Atomics.load(view, READY) === 1;
  return ready;
}

function exchange(command: string, timeoutMs: number): string | null {
  if (!ensureHelper() || !view || !sab) return null;
  const encoded = Buffer.from(command, "utf8");
  if (encoded.length > 8000) return null;
  new Uint8Array(sab).set(encoded, HEADER);
  Atomics.store(view, LENGTH, encoded.length);
  Atomics.store(view, STATE, REQUEST);
  Atomics.notify(view, STATE);
  const waited = Atomics.wait(view, STATE, REQUEST, timeoutMs);
  if (waited === "timed-out" || Atomics.load(view, STATE) !== RESPONSE) return null;
  const length = Atomics.load(view, LENGTH);
  const text = Buffer.from(new Uint8Array(sab).slice(HEADER, HEADER + length)).toString("utf8");
  Atomics.store(view, STATE, IDLE);
  Atomics.notify(view, STATE);
  return text.trim();
}

export function assignWindowsJob(jobId: string, pid: number): boolean {
  if (process.platform !== "win32") return false;
  return exchange(`ASSIGN ${jobId} ${pid}`, 20_000) === "OK";
}

export function terminateWindowsJob(jobId: string): boolean {
  if (process.platform !== "win32") return false;
  return exchange(`KILL ${jobId}`, 1_000) === "OK";
}
