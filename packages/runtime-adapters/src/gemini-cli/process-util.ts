import { spawn, type ChildProcess } from "node:child_process";

export interface SpawnRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly windowsHide: boolean;
}

export type ProcessSpawner = (request: SpawnRequest) => ChildProcess;

export const nodeProcessSpawner: ProcessSpawner = (request) =>
  spawn(request.command, [...request.args], {
    cwd: request.cwd,
    env: request.env,
    windowsHide: request.windowsHide,
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
  });

export interface ProcessText {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
}

export function readProcessText(child: ChildProcess, timeoutMs: number): Promise<ProcessText> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      finish(() => {
        child.kill();
        reject(new Error("process timed out"));
      });
    }, timeoutMs);
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      finish(() => reject(error));
    });
    child.on("exit", (code) => {
      finish(() => resolve({ stdout, stderr, code }));
    });
  });
}

export async function terminatePidTree(pid: number): Promise<void> {
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      killer.on("exit", () => resolve());
      killer.on("error", () => resolve());
    });
    return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ESRCH") throw error;
  }
}
