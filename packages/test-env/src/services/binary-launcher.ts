import { spawn, type ChildProcess } from "node:child_process";
import type { JobHandle, WindowsJobManager } from "./job.js";
import type { ProcessExitEvent } from "./types.js";

export interface BinarySpawnSpec {
  readonly binary: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly job: JobHandle;
  readonly jobManager: WindowsJobManager;
}

export interface SpawnedServiceProcess {
  readonly pid: number;
  stderr(): string;
  stdout(): string;
  exitCode(): number | null;
  exited(): boolean;
  onExit(listener: (event: ProcessExitEvent) => void): void;
  stop(): Promise<void>;
  waitForExit(): Promise<number | null>;
}

/**
 * Spawns a backing-service binary and assigns the child to the project
 * service Job Object before anyone treats it as ready.
 */
export class NodeBinaryLauncher {
  async spawn(spec: BinarySpawnSpec): Promise<SpawnedServiceProcess> {
    if (spec.job.limits.killOnJobClose !== true) {
      throw new Error("JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE is required before spawn");
    }
    const child = spawn(spec.binary, [...spec.args], {
      ...(spec.cwd ? { cwd: spec.cwd } : {}),
      env: spec.env ? { ...process.env, ...spec.env } : process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (!child.pid) {
      throw new Error(`failed to spawn ${spec.binary}`);
    }
    await spec.jobManager.assignProcess(spec.job, child.pid);
    return trackChild(child);
  }
}

function trackChild(child: ChildProcess): SpawnedServiceProcess {
  let stderr = "";
  let stdout = "";
  let intentional = false;
  let finished = false;
  let code: number | null = null;
  const listeners: Array<(event: ProcessExitEvent) => void> = [];
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });
  child.on("error", () => undefined);
  child.on("exit", (exitCode) => {
    finished = true;
    code = exitCode;
    const event: ProcessExitEvent = { intentional, stderr, code };
    for (const listener of listeners) listener(event);
  });
  return {
    pid: child.pid ?? 0,
    stderr: () => stderr,
    stdout: () => stdout,
    exitCode: () => code,
    exited: () => finished,
    onExit(listener) {
      listeners.push(listener);
      if (finished) listener({ intentional, stderr, code });
    },
    async stop() {
      intentional = true;
      if (finished) return;
      child.kill();
      await new Promise<void>((resolve) => {
        if (finished) {
          resolve();
          return;
        }
        child.once("exit", () => resolve());
      });
    },
    waitForExit() {
      if (finished) return Promise.resolve(code);
      return new Promise((resolve) => {
        child.once("exit", (exitCode) => resolve(exitCode));
      });
    },
  };
}
