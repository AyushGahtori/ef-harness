import { execFileSync } from "node:child_process";
import fs from "node:fs";

export interface DaemonLockRecord {
  readonly pid: number;
  readonly processStartTime: string;
}

/**
 * A live PID is not ownership. Windows reuses PIDs, so the lock stores the
 * process start token and a later open compares that token.
 */
export function readProcessStartTime(pid: number): string | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (process.platform === "win32") return readWindowsStartTime(pid);
  return readPosixStartTime(pid);
}

export function daemonLockHeld(file: string): boolean {
  const record = readDaemonLock(file);
  if (!record) return false;
  if (record.pid === process.pid) return false;
  if (!pidAlive(record.pid)) return false;
  const observed = readProcessStartTime(record.pid);
  if (observed === null) return true;
  return observed === record.processStartTime;
}

export function writeDaemonLock(file: string): void {
  const observed = readProcessStartTime(process.pid);
  const processStartTime = observed ?? `uptime:${process.pid}:${Math.round(process.uptime() * 1000)}`;
  const body = JSON.stringify({ pid: process.pid, processStartTime });
  fs.writeFileSync(file, body);
}

export function readDaemonLock(file: string): DaemonLockRecord | null {
  if (!fs.existsSync(file)) return null;
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8").trim();
  } catch {
    return null;
  }
  if (text.length === 0) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object") return null;
    const record = value as { pid?: unknown; processStartTime?: unknown };
    if (typeof record.pid !== "number" || !Number.isInteger(record.pid) || record.pid <= 0) return null;
    if (typeof record.processStartTime !== "string" || record.processStartTime.length === 0) return null;
    return { pid: record.pid, processStartTime: record.processStartTime };
  } catch {
    return null;
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    return code === "EPERM";
  }
}

function readWindowsStartTime(pid: number): string | null {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `try { $proc = Get-Process -Id ${pid} -ErrorAction Stop; Write-Output ([DateTimeOffset]::new($proc.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds()) } catch { exit 3 }`,
  ].join("; ");
  try {
    const stdout = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15_000,
    });
    const value = stdout.trim();
    return /^-?\d+$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

function readPosixStartTime(pid: number): string | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const close = stat.lastIndexOf(")");
    if (close < 0) return null;
    const fields = stat.slice(close + 2).split(" ");
    const startTicks = fields[19];
    return startTicks && /^\d+$/.test(startTicks) ? startTicks : null;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "ENOENT") return null;
  }
  try {
    const stdout = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 5_000,
    });
    const value = stdout.trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}
