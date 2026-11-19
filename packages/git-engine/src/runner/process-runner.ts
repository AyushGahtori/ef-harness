import { spawn, type ChildProcess } from "node:child_process";

export interface RunProcessOptions {
  readonly binary: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
  readonly maxOutputBytes?: number;
}

export interface RunProcessResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly spawnError: NodeJS.ErrnoException | null;
}

function asBuffer(chunk: string | Buffer): Buffer {
  return typeof chunk === "string" ? Buffer.from(chunk) : chunk;
}

function killProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (process.platform === "win32" && typeof pid === "number") {
    spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
      shell: false,
      windowsHide: true,
      stdio: "ignore",
    });
    return;
  }
  child.kill("SIGKILL");
}

/**
 * Spawn a process with `shell: false` and `windowsHide: true`.
 * Arguments stay an array so paths and branch names are never interpolated into a shell string.
 */
export function runProcess(options: RunProcessOptions): Promise<RunProcessResult> {
  const started = performance.now();
  const maxOutputBytes = options.maxOutputBytes ?? 32 * 1024 * 1024;
  return new Promise((resolve) => {
    let settled = false;
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let spawnError: NodeJS.ErrnoException | null = null;

    const child = spawn(options.binary, [...options.args], {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stderrText = Buffer.concat(stderr).toString("utf8");
      const timeoutNote = timedOut ? `Git command timed out after ${options.timeoutMs} ms.` : "";
      resolve({
        exitCode,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: timeoutNote ? `${stderrText}${stderrText ? "\n" : ""}${timeoutNote}` : stderrText,
        durationMs: Math.max(0, Math.round(performance.now() - started)),
        timedOut,
        spawnError,
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
    }, options.timeoutMs);

    const capture = (target: Buffer[], current: number, chunk: string | Buffer, isStdout: boolean): number => {
      const buffer = asBuffer(chunk);
      const next = current + buffer.length;
      if (next > maxOutputBytes) {
        if (isStdout) {
          stderr.push(Buffer.from("\nGit output exceeded the harness capture limit.\n"));
        }
        killProcessTree(child);
        return next;
      }
      target.push(buffer);
      return next;
    };

    child.stdout?.on("data", (chunk: string | Buffer) => {
      stdoutBytes = capture(stdout, stdoutBytes, chunk, true);
    });
    child.stderr?.on("data", (chunk: string | Buffer) => {
      stderrBytes = capture(stderr, stderrBytes, chunk, false);
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      spawnError = error;
      finish(null);
    });
    child.on("close", (code) => {
      finish(code);
    });
  });
}
