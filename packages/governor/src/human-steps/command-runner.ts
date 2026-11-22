import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";

import { assertProbeTimeout } from "./timeout.js";
import type { CommandRunRequest, CommandRunResult, CommandRunner } from "./ports.js";

const OUTPUT_CAP = 64 * 1024;

export function nodeCommandRunner(): CommandRunner {
  return {
    run(request: CommandRunRequest): Promise<CommandRunResult> {
      return runCommand(request);
    },
  };
}

export async function runCommand(request: CommandRunRequest): Promise<CommandRunResult> {
  assertProbeTimeout(request.timeoutMs);
  const started = Date.now();
  const resolved = await resolveExecutable(request.file);
  if (!resolved) {
    return {
      exitCode: null,
      stdout: "",
      stderr: "",
      errorCode: "ENOENT",
      durationMs: Date.now() - started,
      timedOut: false,
    };
  }
  return spawnCaptured(resolved, request, started);
}

async function resolveExecutable(file: string): Promise<string | null> {
  if (file.includes("/") || file.includes("\\") || path.isAbsolute(file)) {
    return (await exists(file)) ? file : null;
  }
  if (process.platform === "win32") {
    const where = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "where.exe");
    const listed = await spawnCaptured(
      where,
      { file: where, args: [file], timeoutMs: 5_000 },
      Date.now(),
    );
    const line = listed.stdout
      .split(/\r?\n/)
      .map((item) => item.trim())
      .find((item) => item.length > 0);
    return line ?? null;
  }
  const listed = await spawnCaptured(
    "/usr/bin/which",
    { file: "/usr/bin/which", args: [file], timeoutMs: 5_000 },
    Date.now(),
  );
  const line = listed.stdout.trim().split(/\r?\n/)[0]?.trim() ?? "";
  return listed.exitCode === 0 && line.length > 0 ? line : null;
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file, constants.X_OK);
    return true;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "ENOENT") return false;
    try {
      await access(file, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}

function spawnCaptured(file: string, request: CommandRunRequest, started: number): Promise<CommandRunResult> {
  return new Promise((resolve) => {
    const child = spawnFile(file, request.args, request.cwd);
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: CommandRunResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const timer = setTimeout(() => {
      killChild(child.pid);
      finish({
        exitCode: null,
        stdout: clip(stdout),
        stderr: clip(stderr),
        errorCode: "TIMEOUT",
        durationMs: Date.now() - started,
        timedOut: true,
      });
    }, request.timeoutMs);
    const onAbort = (): void => {
      clearTimeout(timer);
      killChild(child.pid);
      finish({
        exitCode: null,
        stdout: clip(stdout),
        stderr: clip(stderr),
        errorCode: "ABORTED",
        durationMs: Date.now() - started,
        timedOut: false,
      });
    };
    if (request.signal?.aborted) onAbort();
    else request.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout = clip(stdout + chunk);
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr = clip(stderr + chunk);
    });
    child.once("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", onAbort);
      finish({
        exitCode: null,
        stdout: clip(stdout),
        stderr: clip(stderr),
        errorCode: error.code === "ENOENT" ? "ENOENT" : null,
        durationMs: Date.now() - started,
        timedOut: false,
      });
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", onAbort);
      finish({
        exitCode: code,
        stdout: clip(stdout),
        stderr: clip(stderr),
        errorCode: null,
        durationMs: Date.now() - started,
        timedOut: false,
      });
    });
  });
}

function spawnFile(file: string, args: readonly string[], cwd?: string): ReturnType<typeof spawn> {
  const options = {
    windowsHide: true,
    shell: false,
    ...(cwd === undefined ? {} : { cwd }),
  } as const;
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(file)) {
    const comspec = process.env.ComSpec ?? "cmd.exe";
    return spawn(comspec, ["/d", "/s", "/c", quoteCmd(file), ...args.map(quoteCmd)], options);
  }
  return spawn(file, args, options);
}

function quoteCmd(value: string): string {
  if (value.length === 0) return '""';
  if (!/[\s"&|<>^]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

function clip(value: string): string {
  return value.length <= OUTPUT_CAP ? value : value.slice(0, OUTPUT_CAP);
}

function killChild(pid: number | undefined): void {
  if (pid === undefined) return;
  if (process.platform === "win32") {
    const taskkill = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe");
    spawn(taskkill, ["/PID", String(pid), "/T", "/F"], { windowsHide: true, shell: false });
    return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code !== "ESRCH") throw error;
  }
}
