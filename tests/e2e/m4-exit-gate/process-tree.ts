import { spawn, spawnSync, type ChildProcess } from "node:child_process";

const pause = new Int32Array(new SharedArrayBuffer(4));

export function sleepMs(ms: number): void {
  Atomics.wait(pause, 0, 0, ms);
}

export function spawnSleeper(): ChildProcess {
  return spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"], {
    windowsHide: true,
    stdio: "ignore",
  });
}

export function runOkCommand(): { readonly code: number; readonly output: string } {
  const result = spawnSync(process.execPath, ["-e", "console.log('ok')"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000,
  });
  return { code: result.status ?? 1, output: result.stdout };
}

export function isAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function killTree(pid: number): void {
  if (pid <= 0) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    return;
  }
}

export function waitUntilAlive(pid: number): boolean {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (isAlive(pid)) return true;
    sleepMs(25);
  }
  return isAlive(pid);
}

export function waitUntilDead(pid: number): boolean {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (!isAlive(pid)) return true;
    sleepMs(25);
  }
  return !isAlive(pid);
}
