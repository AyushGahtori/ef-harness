import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SpikeError } from "./errors.ts";

const execFileAsync = promisify(execFile);

export interface ProcessIdentity {
  readonly pid: number;
  readonly startUnixMs: number;
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function readProcessIdentity(pid: number): Promise<ProcessIdentity | null> {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const script = [
    `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue`,
    "if ($null -eq $p) { exit 3 }",
    "$dto = New-Object DateTimeOffset $p.StartTime",
    "$dto.ToUnixTimeMilliseconds()",
  ].join("; ");
  const result = await execFileAsync(
    powershellPath(),
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { windowsHide: true, encoding: "utf8" },
  ).catch(() => null);
  if (!result || result.stderr.includes("Cannot find")) return null;
  const line = result.stdout.trim().split(/\r?\n/).at(-1) ?? "";
  const startUnixMs = Number(line);
  if (!Number.isFinite(startUnixMs)) return null;
  return { pid, startUnixMs };
}

export async function sameProcessAlive(identity: ProcessIdentity): Promise<boolean> {
  const current = await readProcessIdentity(identity.pid);
  if (!current) return false;
  return Math.abs(current.startUnixMs - identity.startUnixMs) < 1500;
}

export async function workingSetBytes(pid: number): Promise<number | null> {
  const script = [
    `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue`,
    "if ($null -eq $p) { exit 3 }",
    "$p.WorkingSet64",
  ].join("; ");
  const result = await execFileAsync(
    powershellPath(),
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { windowsHide: true, encoding: "utf8" },
  ).catch(() => null);
  if (!result) return null;
  const value = Number((result.stdout.trim().split(/\r?\n/).at(-1) ?? "").trim());
  return Number.isFinite(value) ? value : null;
}

export async function terminateProcess(pid: number): Promise<void> {
  await execFileAsync("taskkill.exe", ["/F", "/PID", String(pid)], {
    windowsHide: true,
  }).catch((error: unknown) => {
    if (!isProcessAlive(pid)) return;
    const message = error instanceof Error ? error.message : String(error);
    throw new SpikeError("terminate_failed", message);
  });
}

export function powershellPath(): string {
  const root = process.env.SystemRoot ?? "C:\\Windows";
  return `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
}
