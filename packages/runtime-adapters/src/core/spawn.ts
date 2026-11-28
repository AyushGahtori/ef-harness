import { spawn, type ChildProcess } from "node:child_process";
import { SupervisionError } from "./errors.js";

export interface ForeignSpawnRequest {
  readonly sessionId: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly jobId: string;
}

export interface ForeignProcess {
  readonly pid: number;
  onStdout(listener: (chunk: string) => void): void;
  onStderr(listener: (chunk: string) => void): void;
  onExit(listener: (code: number | null) => void): void;
  /** Start the real command. On Windows this happens after the pid is in a job. */
  release(): void;
}

/** Spawn a foreign CLI with `shell: false` so the command is not a shell string. */
export function spawnForeignProcess(request: ForeignSpawnRequest): ForeignProcess {
  if (process.platform === "win32") return spawnInsideJobGate(request);
  const child = spawnDirect(request);
  return withRelease(child, () => undefined);
}

const GATE_SCRIPT = [
  "process.stdin.once('data', () => {",
  "const {spawn} = require('node:child_process');",
  "const spec = JSON.parse(Buffer.from(process.env.EF_GATE_SPEC, 'base64').toString('utf8'));",
  "const child = spawn(spec.command, spec.args, {cwd: spec.cwd, env: spec.env, windowsHide: true, stdio: ['ignore','pipe','pipe'], shell: false});",
  "if (child.stdout) child.stdout.pipe(process.stdout);",
  "if (child.stderr) child.stderr.pipe(process.stderr);",
  "child.on('exit', (code) => process.exit(code == null ? 1 : code));",
  "});",
].join("");

function spawnInsideJobGate(request: ForeignSpawnRequest): ForeignProcess {
  const spec = Buffer.from(
    JSON.stringify({
      command: request.command,
      args: [...request.args],
      cwd: request.cwd,
      env: request.env,
    }),
    "utf8",
  ).toString("base64");
  const child = spawn(process.execPath, ["-e", GATE_SCRIPT], {
    cwd: request.cwd,
    env: { ...request.env, EF_GATE_SPEC: spec },
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (!child.pid || child.pid <= 0) {
    child.kill();
    throw new SupervisionError("spawn_failed", `Failed to spawn ${request.command}`);
  }
  let released = false;
  return withRelease(child, () => {
    if (released) return;
    released = true;
    child.stdin?.write("\n");
    child.stdin?.end();
  });
}

function spawnDirect(request: ForeignSpawnRequest): ChildProcess {
  const child = spawn(request.command, [...request.args], {
    cwd: request.cwd,
    env: { ...request.env },
    shell: false,
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (!child.pid || child.pid <= 0) {
    child.kill();
    throw new SupervisionError("spawn_failed", `Failed to spawn ${request.command}`);
  }
  return child;
}

function withRelease(child: ChildProcess, release: () => void): ForeignProcess {
  const pid = child.pid;
  if (!pid) throw new SupervisionError("spawn_failed", "Foreign process did not receive a pid");
  return { ...bindPipes(child, pid), release };
}

function bindPipes(child: ChildProcess, pid: number): Omit<ForeignProcess, "release"> {
  const stdoutBuffer: string[] = [];
  const stderrBuffer: string[] = [];
  let stdoutListener: ((chunk: string) => void) | null = null;
  let stderrListener: ((chunk: string) => void) | null = null;
  let exitListener: ((code: number | null) => void) | null = null;
  let exitCode: number | null | undefined;

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    if (stdoutListener) stdoutListener(chunk);
    else stdoutBuffer.push(chunk);
  });
  child.stderr?.on("data", (chunk: string) => {
    if (stderrListener) stderrListener(chunk);
    else stderrBuffer.push(chunk);
  });
  child.on("exit", (code) => {
    exitCode = code;
    exitListener?.(code);
  });

  return {
    pid,
    onStdout(listener) {
      stdoutListener = listener;
      for (const chunk of stdoutBuffer.splice(0)) listener(chunk);
    },
    onStderr(listener) {
      stderrListener = listener;
      for (const chunk of stderrBuffer.splice(0)) listener(chunk);
    },
    onExit(listener) {
      exitListener = listener;
      if (exitCode !== undefined) listener(exitCode);
    },
  };
}
