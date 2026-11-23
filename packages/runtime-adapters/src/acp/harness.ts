import { spawn } from "node:child_process";
import type { WindowsJobPort } from "./job.js";
import type { RegisteredSecret } from "./types.js";

export interface SandboxedCommandRequest {
  readonly attemptId: string;
  readonly taskId: string;
  readonly worktreePath: string;
  readonly command: string;
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly jobId?: string;
  readonly signal?: AbortSignal;
  readonly secrets?: readonly RegisteredSecret[];
}

export interface SandboxedCommandResult {
  readonly exitCode: number;
  readonly timedOut: boolean;
  readonly stdoutSummary: string;
  readonly stderrSummary: string;
  readonly commandId: string;
  readonly durationMs: number;
}

/**
 * Local port of `harness.run`.
 * The published engine is Task 047 `HarnessRunEngine.executeSandboxedCommand`
 * (Task 143's text names this Task 048).
 */
export interface HarnessRunPort {
  executeSandboxedCommand(request: SandboxedCommandRequest): Promise<SandboxedCommandResult>;
}

export interface HarnessRunDependencies {
  readonly jobs?: WindowsJobPort;
  readonly redact?: (text: string) => string;
}

export class LocalHarnessRunEngine implements HarnessRunPort {
  private nextId = 1;

  constructor(private readonly deps: HarnessRunDependencies = {}) {}

  executeSandboxedCommand(request: SandboxedCommandRequest): Promise<SandboxedCommandResult> {
    const commandId = `cmd-${this.nextId}`;
    this.nextId += 1;
    const started = Date.now();
    const parsed = splitCommand(request.command);
    const cwd = request.cwd ?? request.worktreePath;
    return new Promise((resolve) => {
      const child = spawn(parsed.file, parsed.args, {
        cwd,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: scrubbedProcessEnv(),
      });
      if (request.jobId && child.pid && this.deps.jobs) this.deps.jobs.attach(request.jobId, child.pid);
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      let timedOut = false;
      const timer =
        request.timeoutMs === undefined
          ? null
          : setTimeout(() => {
              timedOut = true;
              if (child.pid) killQuiet(child.pid);
            }, request.timeoutMs);
      const onAbort = () => {
        if (child.pid) killQuiet(child.pid);
      };
      if (request.signal) {
        if (request.signal.aborted) onAbort();
        else request.signal.addEventListener("abort", onAbort, { once: true });
      }
      child.on("error", () => {
        if (timer) clearTimeout(timer);
        resolve(this.finish(commandId, started, 127, timedOut, "", "spawn failed"));
      });
      child.on("close", (code) => {
        if (timer) clearTimeout(timer);
        if (request.signal) request.signal.removeEventListener("abort", onAbort);
        resolve(
          this.finish(
            commandId,
            started,
            code ?? 1,
            timedOut,
            Buffer.concat(stdout).toString("utf8"),
            Buffer.concat(stderr).toString("utf8"),
          ),
        );
      });
    });
  }

  private finish(
    commandId: string,
    started: number,
    exitCode: number,
    timedOut: boolean,
    stdout: string,
    stderr: string,
  ): SandboxedCommandResult {
    const redact = this.deps.redact ?? ((text: string) => text);
    return {
      commandId,
      exitCode,
      timedOut,
      stdoutSummary: redact(boundText(stdout)),
      stderrSummary: redact(boundText(stderr)),
      durationMs: Date.now() - started,
    };
  }
}

function boundText(text: string): string {
  const lines = text.split(/\r?\n/);
  const head = lines.slice(0, 100);
  const tail = lines.length > 300 ? lines.slice(-200) : [];
  const omitted = Math.max(0, lines.length - head.length - tail.length);
  const banner = omitted > 0 ? `\n${omitted} lines omitted; use harness.read_log(...)` : "";
  return `${head.join("\n")}${banner}${tail.length > 0 ? `\n${tail.join("\n")}` : ""}`;
}

function scrubbedProcessEnv(): NodeJS.ProcessEnv {
  const allow = ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "COMSPEC", "WINDIR", "TEMP", "TMP"];
  const env: NodeJS.ProcessEnv = {};
  for (const key of allow) {
    const value = process.env[key];
    if (typeof value === "string") env[key] = value;
  }
  return env;
}

function killQuiet(pid: number): void {
  if (process.platform === "win32") {
    spawn(process.env.COMSPEC ?? "cmd.exe", ["/d", "/s", "/c", "taskkill", "/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    return;
  }
}

export function splitCommand(command: string): { file: string; args: string[] } {
  const tokens: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const match of command.trim().matchAll(pattern)) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  const file = tokens[0] ?? "";
  return { file, args: tokens.slice(1) };
}
