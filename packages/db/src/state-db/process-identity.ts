import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { randomUUID } from "node:crypto";
import type { StaleOwnerReason, WriterOwner } from "./types.js";

export interface ProcessIdentity {
  pid: number;
  processStartTime: string;
  hostname: string;
}

export type OwnerClassification =
  | { kind: "none" }
  | { kind: "self" }
  | { kind: "live-other" }
  | { kind: "dead"; reason: StaleOwnerReason }
  | { kind: "reused"; reason: StaleOwnerReason };

let cachedIdentity: ProcessIdentity | undefined;

export function currentProcessIdentity(): ProcessIdentity {
  if (!cachedIdentity) {
    const startTime = queryStartTime(process.pid) ?? `local:${process.pid}:${randomUUID()}`;
    cachedIdentity = {
      pid: process.pid,
      processStartTime: startTime,
      hostname: os.hostname(),
    };
  }
  return cachedIdentity;
}

/**
 * A live PID is not enough: Windows reuses PIDs. The creation timestamp must match too.
 */
export function classifyOwner(previous: WriterOwner | null): OwnerClassification {
  if (!previous) return { kind: "none" };
  const current = currentProcessIdentity();
  if (!Number.isInteger(previous.pid) || previous.pid <= 0) {
    return { kind: "dead", reason: "pid_dead" };
  }
  if (previous.pid === current.pid && previous.processStartTime === current.processStartTime) {
    return { kind: "self" };
  }
  if (!pidExists(previous.pid)) {
    return { kind: "dead", reason: "pid_dead" };
  }
  const observed = previous.pid === current.pid ? current.processStartTime : queryStartTime(previous.pid);
  if (observed === null) {
    return { kind: "live-other" };
  }
  if (observed === previous.processStartTime) {
    return previous.pid === current.pid ? { kind: "self" } : { kind: "live-other" };
  }
  return { kind: "reused", reason: "pid_reused" };
}

export function pidExists(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM";
  }
}

export function queryStartTime(pid: number): string | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (cachedIdentity && pid === cachedIdentity.pid) return cachedIdentity.processStartTime;
  if (process.platform === "win32") return queryWindowsStartTime(pid);
  return queryPosixStartTime(pid);
}

function queryWindowsStartTime(pid: number): string | null {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `try { $process = Get-Process -Id ${pid} -ErrorAction Stop; Write-Output ([DateTimeOffset]::new($process.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds()) } catch { exit 3 }`,
  ].join("; ");
  try {
    const stdout = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { encoding: "utf8", windowsHide: true, timeout: 15_000 },
    );
    const value = stdout.trim();
    return /^-?\d+$/.test(value) ? value : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.length === 0) return null;
    return null;
  }
}

function queryPosixStartTime(pid: number): string | null {
  const statPath = `/proc/${pid}/stat`;
  try {
    const stat = fs.readFileSync(statPath, "utf8");
    const close = stat.lastIndexOf(")");
    if (close < 0) return null;
    const fields = stat.slice(close + 2).split(" ");
    const startTicks = fields[19];
    return startTicks && /^\d+$/.test(startTicks) ? startTicks : null;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
  }
  try {
    const stdout = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 5_000,
    });
    const value = stdout.trim();
    return value.length > 0 ? value : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.length === 0) return null;
    return null;
  }
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = error.code;
  return typeof code === "string" ? code : undefined;
}
