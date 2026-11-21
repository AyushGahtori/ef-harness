import { spawn } from "node:child_process";
import { ConverterProcessError, ConverterTimeoutError } from "../errors.js";
import { WindowsJobSupervisor } from "./windows-job-supervisor.js";

export interface SandboxRunRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly wallClockMs: number;
  readonly memoryLimitBytes: number;
  readonly stdin: string;
}

export interface SandboxRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly pid: number;
  readonly jobAssigned: boolean;
  readonly timedOut: boolean;
  readonly memoryLimitBytes: number;
  readonly wallClockMs: number;
}

export interface SandboxRunner {
  runIsolated(request: SandboxRunRequest): Promise<SandboxRunResult>;
}

export class NodeSandboxRunner implements SandboxRunner {
  constructor(private readonly jobs = new WindowsJobSupervisor()) {}

  async runIsolated(request: SandboxRunRequest): Promise<SandboxRunResult> {
    const child = spawn(request.command, [...request.args], {
      cwd: request.cwd,
      env: request.env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (child.pid === undefined) {
      child.kill();
      throw new ConverterProcessError("Converter child process did not start.");
    }
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    const exited = new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolve(code ?? 1));
    });
    const job = await this.jobs.attach({
      pid: child.pid,
      memoryLimitBytes: request.memoryLimitBytes,
      killOnJobClose: true,
      network: "deny",
    });
    let timedOut = false;
    try {
      child.stdin?.write(request.stdin);
      child.stdin?.end();
      const exitCode = await new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => {
          timedOut = true;
          void job.terminate();
          child.kill();
          reject(new ConverterTimeoutError(stderr.trim().slice(0, 500) || stdout.trim().slice(0, 500)));
        }, request.wallClockMs);
        exited.then(
          (code) => {
            clearTimeout(timer);
            resolve(code);
          },
          (error: unknown) => {
            clearTimeout(timer);
            reject(error instanceof Error ? error : new Error(String(error)));
          },
        );
      });
      return {
        exitCode,
        stdout,
        stderr,
        pid: child.pid,
        jobAssigned: job.assigned,
        timedOut,
        memoryLimitBytes: request.memoryLimitBytes,
        wallClockMs: request.wallClockMs,
      };
    } finally {
      await job.terminate();
    }
  }
}
