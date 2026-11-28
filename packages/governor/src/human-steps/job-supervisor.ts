import { spawn } from "node:child_process";
import path from "node:path";

import type { SupervisedCommandRequest, SupervisedCommandResult, WindowsJobSupervisor } from "./ports.js";

/**
 * Local stand-in for Task 040 `WindowsJobManager.runCommand` / `terminateJob`.
 * Cancel kills the process tree (`taskkill /T /F` on Windows). Swap this class
 * for the native Job Object supervisor at integration.
 */
export class ChildProcessJobSupervisor implements WindowsJobSupervisor {
  async runCommand(request: SupervisedCommandRequest): Promise<SupervisedCommandResult> {
    const started = Date.now();
    const child = spawnCommand(request.file, request.args, request.cwd);
    const jobId = `cmd-${child.pid ?? started}`;
    let settled = false;
    const output = (stream: "stdout" | "stderr", text: string): void => {
      request.onOutput?.({ stream, text });
    };
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => output("stdout", chunk));
    child.stderr?.on("data", (chunk: string) => output("stderr", chunk));
    const kill = (): void => {
      if (child.pid !== undefined) terminateTree(child.pid);
    };
    if (request.signal?.aborted) kill();
    else request.signal?.addEventListener("abort", kill, { once: true });
    const timer = setTimeout(kill, request.timeoutMs);
    const exitCode = await new Promise<number | null>((resolve) => {
      child.once("exit", (code) => {
        if (settled) return;
        settled = true;
        resolve(code);
      });
      child.once("error", () => {
        if (settled) return;
        settled = true;
        resolve(null);
      });
    });
    clearTimeout(timer);
    request.signal?.removeEventListener("abort", kill);
    const terminated = request.signal?.aborted === true;
    return {
      reason: terminated ? "terminated" : "exited",
      exitCode: terminated ? null : exitCode,
      durationMs: Date.now() - started,
      jobId,
    };
  }
}

function spawnCommand(file: string, args: readonly string[], cwd?: string): ReturnType<typeof spawn> {
  const options = { windowsHide: true, shell: false, ...(cwd === undefined ? {} : { cwd }) };
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(file)) {
    const comspec = process.env.ComSpec ?? "cmd.exe";
    return spawn(comspec, ["/d", "/s", "/c", file, ...args], options);
  }
  return spawn(file, args, options);
}

function terminateTree(pid: number): void {
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
