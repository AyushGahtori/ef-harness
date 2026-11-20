import { spawn } from "node:child_process";

/**
 * Local port of Task 047 `HarnessRunEngine.executeSandboxedCommand`.
 * Separates stdout and stderr and returns the raw exit code.
 * Swap for the sandbox engine when Task 047 is integrated. This stand-in
 * does not apply the sandbox allowlist; it only gives the CLI verifier a
 * process boundary with strict stream separation.
 */

export interface SandboxedCommandRequest {
  readonly command: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
}

export interface SandboxedCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export interface HarnessRunEngine {
  executeSandboxedCommand(request: SandboxedCommandRequest): Promise<SandboxedCommandResult>;
}

export class LocalHarnessRunEngine implements HarnessRunEngine {
  async executeSandboxedCommand(request: SandboxedCommandRequest): Promise<SandboxedCommandResult> {
    const [executable, ...args] = request.command;
    if (!executable) {
      throw new Error("command is empty");
    }
    const timeoutMs = request.timeoutMs ?? 10_000;
    return new Promise((resolve, reject) => {
      const child = spawn(executable, [...args], {
        cwd: request.cwd,
        env: { ...process.env, ...request.env },
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({
          exitCode: code ?? (timedOut ? 124 : 1),
          stdout,
          stderr,
          timedOut,
        });
      });
    });
  }
}
