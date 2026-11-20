import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";

export interface CommandOutput {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly notFound: boolean;
}

export interface CommandRunOptions {
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly cwd?: string;
}

export interface CommandRunner {
  run(command: string, args: readonly string[], options: CommandRunOptions): Promise<CommandOutput>;
}

const OUTPUT_CAP = 256 * 1024;

function appendCapped(current: string, chunk: string): string {
  if (current.length >= OUTPUT_CAP) return current;
  return (current + chunk).slice(0, OUTPUT_CAP);
}

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export function spawnCommand(
  command: string,
  args: readonly string[],
  options: CommandRunOptions,
): Promise<CommandOutput> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: CommandOutput): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const child: ChildProcess = spawn(command, [...args], {
      cwd: options.cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout = appendCapped(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr = appendCapped(stderr, chunk);
    });
    const timer = setTimeout(() => {
      child.kill();
      finish({ code: null, stdout, stderr, timedOut: true, notFound: false });
    }, options.timeoutMs);
    const onAbort = (): void => {
      clearTimeout(timer);
      child.kill();
      finish({ code: null, stdout, stderr, timedOut: true, notFound: false });
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", (error) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      finish({
        code: 1,
        stdout,
        stderr: appendCapped(stderr, error.message),
        timedOut: false,
        notFound: isEnoent(error),
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      finish({ code, stdout, stderr, timedOut: false, notFound: false });
    });
  });
}

export function createProcessRunner(): CommandRunner {
  return { run: spawnCommand };
}
