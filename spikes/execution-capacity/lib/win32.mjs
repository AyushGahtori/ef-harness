import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { spawnCaptured } from "./spawn.mjs";

const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "win32.ps1");

/**
 * @param {string} action
 * @param {readonly string[]} extra
 * @param {number} [timeoutMs]
 */
export function runWin32(action, extra = [], timeoutMs = 20000) {
  return spawnCaptured(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-Action", action, ...extra],
    { timeoutMs },
  );
}

/**
 * @param {string} stdout
 */
export function parseEvents(stdout) {
  const events = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      // Ignore non-JSON noise from the host.
    }
  }
  return events;
}

/**
 * One PowerShell process serves repeated samples so PDH does not reload each time.
 * @param {string} volumePath
 */
export function startSampler(volumePath) {
  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-Action", "serve"],
    { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  let buffer = "";
  /** @type {((event: Record<string, unknown>) => void)[]} */
  const waiters = [];
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      if (!line.startsWith("{")) continue;
      try {
        const event = JSON.parse(line);
        const waiter = waiters.shift();
        if (waiter) waiter(event);
      } catch {
        // Ignore partial JSON noise.
      }
    }
  });
  return {
    pid: child.pid ?? null,
    sample() {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`sample timed out: ${stderr}`));
        }, 25000);
        waiters.push((event) => {
          clearTimeout(timer);
          if (event.event === "error") {
            reject(new Error(String(event.message ?? "sample failed")));
            return;
          }
          resolve(event);
        });
        child.stdin.write(`sample|${volumePath}\n`);
      });
    },
    async dispose() {
      try {
        child.stdin.write("exit\n");
      } catch {
        // The pipe may already be closed.
      }
      if (child.exitCode === null) child.kill();
      await new Promise((resolve) => {
        if (child.exitCode !== null) {
          resolve(undefined);
          return;
        }
        child.once("close", () => resolve(undefined));
      });
    },
  };
}

/**
 * @param {string} volumePath
 */
export async function sampleHost(volumePath) {
  const result = await runWin32("sample", ["-VolumePath", volumePath], 30000);
  const events = parseEvents(result.stdout);
  const sample = events.find((event) => event.event === "sample");
  if (!sample) {
    throw new Error(`Windows sample failed (${result.code}): ${result.stderr || result.stdout}`);
  }
  return sample;
}

/**
 * Hold a Job Object around an existing process until the holder is killed
 * or the process exits. Closing the holder kills the process tree.
 * @param {number} pid
 * @param {number} memoryLimitBytes
 */
export function holdJob(pid, memoryLimitBytes) {
  const child = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-Action",
      "job-hold",
      "-TargetPid",
      String(pid),
      "-MemoryLimitBytes",
      String(memoryLimitBytes),
    ],
    { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`job holder timed out: ${stderr}`));
    }, 8000);
    const poll = setInterval(() => {
      const events = parseEvents(stdout);
      const failed = events.find((event) => event.event === "error");
      const attached = events.find((event) => event.event === "ready");
      if (failed) {
        clearInterval(poll);
        clearTimeout(timer);
        reject(new Error(`${failed.message} win32=${failed.win32}`));
      } else if (attached) {
        clearInterval(poll);
        clearTimeout(timer);
        resolve(attached);
      }
    }, 30);
  });
  return {
    pid: child.pid ?? null,
    ready,
    async dispose() {
      if (child.exitCode === null && child.pid) {
        child.kill();
      }
      await new Promise((resolve) => {
        if (child.exitCode !== null) {
          resolve(undefined);
          return;
        }
        child.once("close", () => resolve(undefined));
      });
    },
    output() {
      return { stdout, stderr };
    },
  };
}
