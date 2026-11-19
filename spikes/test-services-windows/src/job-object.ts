import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SpikeError, errorText } from "./errors.ts";
import { powershellPath } from "./process-table.ts";

export interface JobSpawnSpec {
  readonly application: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly stdoutPath?: string;
  readonly stderrPath?: string;
}

interface HolderMessage {
  ok?: boolean;
  op?: string;
  error?: string;
  pid?: number;
  jobName?: string;
}

export function quoteWindowsArg(arg: string): string {
  if (arg.length === 0) return '""';
  if (!/[\t "]/.test(arg)) return arg;
  const escaped = arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, "$1$1");
  return `"${escaped}"`;
}

export function windowsCommandLine(application: string, args: readonly string[]): string {
  return [quoteWindowsArg(application), ...args.map(quoteWindowsArg)].join(" ");
}

export class WindowsJob {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending: string[] = [];
  private readonly waiters: Array<(line: string) => void> = [];
  private buffer = "";
  private chain: Promise<void> = Promise.resolve();
  private stderr = "";
  private closed = false;
  jobName = "";

  private constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.push(chunk));
    child.stderr.on("data", (chunk: string) => {
      this.stderr += chunk;
    });
    child.on("exit", () => {
      this.closed = true;
      const waiter = this.waiters.shift();
      if (waiter) waiter("");
    });
  }

  static async open(): Promise<WindowsJob> {
    if (process.platform !== "win32") {
      throw new SpikeError("unsupported_platform", "Windows Job Objects are only available on win32.");
    }
    const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "job-holder.ps1");
    const child = spawn(
      powershellPath(),
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script],
      { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, shell: false },
    );
    const job = new WindowsJob(child);
    try {
      const reply = await job.request({ op: "init", parentPid: process.pid });
      if (!reply.jobName) {
        throw new SpikeError("job_init_failed", "Job holder did not return a job name.");
      }
      job.jobName = reply.jobName;
      return job;
    } catch (error) {
      child.kill();
      throw error;
    }
  }

  capturedStderr(): string {
    return this.stderr;
  }

  async assign(pid: number): Promise<void> {
    await this.request({ op: "assign", pid });
  }

  async spawn(spec: JobSpawnSpec): Promise<number> {
    if (spec.stdoutPath) mkdirSync(path.dirname(spec.stdoutPath), { recursive: true });
    if (spec.stderrPath) mkdirSync(path.dirname(spec.stderrPath), { recursive: true });
    const reply = await this.request({
      op: "spawn",
      application: spec.application,
      commandLine: windowsCommandLine(spec.application, spec.args),
      cwd: spec.cwd ?? "",
      stdoutPath: spec.stdoutPath ?? "",
      stderrPath: spec.stderrPath ?? "",
    });
    if (!reply.pid || reply.pid <= 0) {
      throw new SpikeError("job_spawn_failed", "Job holder did not return a child pid.");
    }
    return reply.pid;
  }

  async enrollHolder(): Promise<void> {
    await this.request({ op: "enroll-self" });
  }

  async release(): Promise<void> {
    if (this.closed) return;
    try {
      await this.request({ op: "release" });
    } catch (error) {
      if (this.closed) return;
      throw error;
    }
  }

  private request(message: Record<string, unknown>): Promise<HolderMessage> {
    const run = this.chain.then(() => this.requestNow(message));
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async requestNow(message: Record<string, unknown>): Promise<HolderMessage> {
    if (this.closed) {
      throw new SpikeError("job_closed", `Job holder already exited. stderr:\n${this.stderr}`);
    }
    const stdin = this.child.stdin;
    const line = `${JSON.stringify(message)}\n`;
    await new Promise<void>((resolve, reject) => {
      stdin.write(line, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    const raw = await Promise.race([
      this.nextLine(),
      new Promise<string>((resolve) => {
        setTimeout(() => resolve(""), 60_000);
      }),
    ]);
    if (!raw) {
      throw new SpikeError("job_closed", `Job holder closed the protocol. stderr:\n${this.stderr}`);
    }
    let parsed: HolderMessage;
    try {
      parsed = JSON.parse(raw) as HolderMessage;
    } catch (error) {
      throw new SpikeError("job_protocol", `Unreadable job holder line ${raw}: ${errorText(error)}`);
    }
    if (!parsed.ok) {
      throw new SpikeError("job_operation_failed", parsed.error ?? `Job operation ${message.op} failed.`);
    }
    return parsed;
  }

  private nextLine(): Promise<string> {
    const queued = this.pending.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  private push(chunk: string): void {
    this.buffer += chunk;
    while (true) {
      const index = this.buffer.indexOf("\n");
      if (index < 0) break;
      const line = this.buffer.slice(0, index).replace(/\r$/, "");
      this.buffer = this.buffer.slice(index + 1);
      if (!line.trim()) continue;
      const waiter = this.waiters.shift();
      if (waiter) waiter(line);
      else this.pending.push(line);
    }
  }
}
