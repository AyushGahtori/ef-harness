import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  JobObjectError,
  type JobAccounting,
  type JobProcessInfo,
  type ProcessInspection,
} from "./types.js";

const CSC = "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe";

type Json = Record<string, unknown>;

let compiledHelper: Promise<string> | undefined;

export function win32HelperExecutable(): Promise<string> {
  compiledHelper ??= compileHelper();
  return compiledHelper;
}

async function compileHelper(): Promise<string> {
  const sourcePath = fileURLToPath(new URL("./win32-job-helper.cs", import.meta.url));
  const source = fs.readFileSync(sourcePath);
  const hash = createHash("sha256").update(source).digest("hex").slice(0, 16);
  const directory = path.join(os.tmpdir(), "ef-harness-win32-job-helper");
  fs.mkdirSync(directory, { recursive: true });
  const executable = path.join(directory, `${hash}.exe`);
  if (fs.existsSync(executable)) return executable;
  if (!fs.existsSync(CSC)) {
    throw new JobObjectError("helper_compile", `C# compiler is not available at ${CSC}`);
  }
  const result = spawnSync(
    CSC,
    [
      "/nologo",
      "/platform:x64",
      "/optimize+",
      "/r:System.Web.Extensions.dll",
      `/out:${executable}`,
      sourcePath,
    ],
    { encoding: "utf8", windowsHide: true },
  );
  if (result.status !== 0 || !fs.existsSync(executable)) {
    throw new JobObjectError(
      "helper_compile",
      `job helper compile failed\n${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim(),
    );
  }
  return executable;
}

export interface NativeJobInfo {
  readonly jobId: number;
  readonly memoryBytes: number;
  readonly activeProcessLimit: number;
  readonly cpuRatePercent: number | null;
  readonly limitFlags: number;
  readonly uiRestrictions: number;
  readonly killOnJobClose: boolean;
  readonly uiHandlesRestricted: boolean;
}

export interface NativeSpawnInfo {
  readonly slot: number;
  readonly pid: number;
  readonly startTime: number;
  readonly imagePath: string | null;
  readonly commandLine: string | null;
}

export interface NativeOutput {
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
}

export class Win32HelperClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly waiters: Array<(message: Json) => void> = [];
  private buffer = "";
  private stderr = "";
  private dead: Error | null = null;
  private nextId = 1;
  private tail: Promise<void> = Promise.resolve();

  private constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      this.onStdout(chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-8000);
    });
    child.on("error", (error) => {
      this.fail(error);
    });
    child.on("exit", (code) => {
      this.fail(new JobObjectError("helper_exit", `job helper exited (${code ?? "signal"}): ${this.stderr}`));
    });
  }

  static async start(): Promise<Win32HelperClient> {
    const executable = await win32HelperExecutable();
    const child = spawn(executable, [String(process.pid)], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const client = new Win32HelperClient(child);
    await client.request({ op: "ping" });
    return client;
  }

  killSync(): void {
    if (!this.child.killed) this.child.kill();
  }

  async dispose(): Promise<void> {
    if (this.dead || this.child.killed) return;
    try {
      await this.request({ op: "shutdown" });
    } catch {
      this.killSync();
    }
  }

  createJob(input: {
    readonly memoryBytes: number;
    readonly activeProcessLimit: number;
    readonly cpuRatePercent: number;
    readonly parentJobId: number;
  }): Promise<NativeJobInfo> {
    return this.request({ op: "createJob", ...input }).then((message) => ({
      jobId: integer(message, "jobId"),
      memoryBytes: integer(message, "memoryBytes"),
      activeProcessLimit: integer(message, "activeProcessLimit"),
      cpuRatePercent: optionalCpu(message),
      limitFlags: integer(message, "limitFlags"),
      uiRestrictions: integer(message, "uiRestrictions"),
      killOnJobClose: flag(message, "killOnJobClose"),
      uiHandlesRestricted: flag(message, "uiHandlesRestricted"),
    }));
  }

  spawn(input: {
    readonly jobId: number;
    readonly application: string;
    readonly commandLine: string;
    readonly cwd?: string;
    readonly capture: boolean;
    readonly resume: boolean;
  }): Promise<NativeSpawnInfo> {
    const payload: Record<string, unknown> = {
      op: "spawn",
      jobId: input.jobId,
      application: input.application,
      commandLine: input.commandLine,
      capture: input.capture,
      resume: input.resume,
    };
    if (input.cwd !== undefined) payload["cwd"] = input.cwd;
    return this.request(payload).then((message) => ({
      slot: integer(message, "slot"),
      pid: integer(message, "pid"),
      startTime: integer(message, "startTime"),
      imagePath: nullableString(message, "imagePath"),
      commandLine: nullableString(message, "commandLine"),
    }));
  }

  resume(slot: number): Promise<void> {
    return this.request({ op: "resume", slot }).then(() => undefined);
  }

  assignPid(jobId: number, pid: number): Promise<NativeSpawnInfo> {
    return this.request({ op: "assignPid", jobId, pid }).then((message) => ({
      slot: 0,
      pid: integer(message, "pid"),
      startTime: integer(message, "startTime"),
      imagePath: nullableString(message, "imagePath"),
      commandLine: nullableString(message, "commandLine"),
    }));
  }

  query(jobId: number): Promise<JobAccounting> {
    return this.request({ op: "query", jobId }).then((message) => ({
      activeProcesses: integer(message, "activeProcesses"),
      totalProcesses: integer(message, "totalProcesses"),
      totalTerminatedProcesses: integer(message, "totalTerminatedProcesses"),
      peakJobMemoryBytes: integer(message, "peakJobMemoryBytes"),
      currentJobMemoryBytes: integer(message, "currentJobMemoryBytes"),
      peakProcessMemoryBytes: integer(message, "peakProcessMemoryBytes"),
      jobMemoryLimitBytes: integer(message, "jobMemoryLimitBytes"),
      processMemoryLimitBytes: integer(message, "processMemoryLimitBytes"),
      activeProcessLimit: integer(message, "activeProcessLimit"),
      userCpuMs: integer(message, "userCpuMs"),
      kernelCpuMs: integer(message, "kernelCpuMs"),
      totalPageFaults: integer(message, "totalPageFaults"),
      limitFlags: integer(message, "limitFlags"),
      uiRestrictions: integer(message, "uiRestrictions"),
      cpuRatePercent: optionalCpu(message),
      killOnJobClose: flag(message, "killOnJobClose"),
      uiHandlesRestricted: flag(message, "uiHandlesRestricted"),
      memoryLimitHit: flag(message, "memoryLimitHit"),
      activeProcessLimitHit: flag(message, "activeProcessLimitHit"),
    }));
  }

  terminate(jobId: number): Promise<void> {
    return this.request({ op: "terminateJob", jobId }).then(() => undefined);
  }

  close(jobId: number): Promise<void> {
    return this.request({ op: "closeJob", jobId }).then(() => undefined);
  }

  inspect(pid: number): Promise<ProcessInspection> {
    return this.request({ op: "inspect", pid }).then((message) => this.inspection(pid, message));
  }

  confirmTerminate(pid: number, startTime: number): Promise<ProcessInspection | "terminated"> {
    return this.request({ op: "confirmTerminate", pid, startTime }).then((message) => {
      if (message["action"] === "terminated") return "terminated";
      return this.inspection(pid, message);
    });
  }

  waitExit(slot: number, timeoutMs: number): Promise<{ exited: boolean; exitCode: number | null }> {
    return this.request({ op: "waitExit", slot, timeoutMs }).then((message) => {
      const exited = flag(message, "exited");
      const exitCode = integer(message, "exitCode");
      return { exited, exitCode: exited ? exitCode : null };
    });
  }

  readOutput(slot: number): Promise<NativeOutput> {
    return this.request({ op: "readOutput", slot }).then((message) => ({
      stdout: text(message, "stdout"),
      stderr: text(message, "stderr"),
      stdoutTruncated: flag(message, "stdoutTruncated"),
      stderrTruncated: flag(message, "stderrTruncated"),
    }));
  }

  listProcesses(jobId: number): Promise<readonly JobProcessInfo[]> {
    return this.request({ op: "listProcesses", jobId }).then((message) => {
      const processes = message["processes"];
      if (!Array.isArray(processes)) {
        throw new JobObjectError("helper_protocol", "process list is missing");
      }
      return processes.map((entry) => {
        if (!entry || typeof entry !== "object") {
          throw new JobObjectError("helper_protocol", "process list entry is invalid");
        }
        const record = entry as Json;
        return {
          pid: integer(record, "pid"),
          imagePath: nullableString(record, "imagePath"),
        };
      });
    });
  }

  handleCount(): Promise<number> {
    return this.request({ op: "handleCount" }).then((message) => integer(message, "handles"));
  }

  private inspection(pid: number, message: Json): ProcessInspection {
    const action = text(message, "action");
    if (action === "alive" || action === "mismatch") {
      return {
        status: "alive",
        pid,
        startTime: integer(message, "startTime"),
        imagePath: nullableString(message, "imagePath"),
        commandLine: nullableString(message, "commandLine"),
      };
    }
    if (action === "unverified") {
      return { status: "unverified", pid, detail: text(message, "detail") };
    }
    return { status: "not_found", pid };
  }

  private request(fields: Record<string, unknown>): Promise<Json> {
    const run = this.tail.then(() => this.requestNow(fields));
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private requestNow(fields: Record<string, unknown>): Promise<Json> {
    if (this.dead) return Promise.reject(this.dead);
    const id = this.nextId;
    this.nextId += 1;
    const line = `${JSON.stringify({ ...fields, id })}\n`;
    const response = new Promise<Json>((resolve, reject) => {
      this.waiters.push((message) => {
        if (message["id"] !== id) {
          if (message["id"] === -1) {
            const detail = typeof message["error"] === "string" ? message["error"] : "job helper failed";
            reject(new JobObjectError("helper_exit", detail));
            return;
          }
          reject(new JobObjectError("helper_protocol", `expected helper response ${id}`));
          return;
        }
        if (message["ok"] !== true) {
          const detail = typeof message["error"] === "string" ? message["error"] : "helper request failed";
          const win32 = message["win32"];
          if (typeof win32 === "number") reject(new JobObjectError("win32", detail, win32));
          else reject(new JobObjectError("win32", detail));
          return;
        }
        resolve(message);
      });
      this.child.stdin.write(line, (error) => {
        if (!error) return;
        const waiter = this.waiters.pop();
        if (waiter) waiter({ id, ok: false, error: error.message });
      });
    });
    return response;
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    while (true) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      const waiter = this.waiters.shift();
      let message: Json;
      try {
        const parsed: unknown = JSON.parse(line);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new JobObjectError("helper_protocol", "helper response is not an object");
        }
        message = parsed as Json;
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error("invalid helper response"));
        return;
      }
      if (!waiter) {
        this.fail(new JobObjectError("helper_protocol", `unexpected helper response: ${line}`));
        return;
      }
      waiter(message);
    }
  }

  private fail(error: Error): void {
    if (!this.dead) this.dead = error;
    const waiters = this.waiters.splice(0);
    for (const waiter of waiters) {
      waiter({ id: -1, ok: false, error: error.message });
    }
  }
}

function integer(message: Json, key: string): number {
  const value = message[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new JobObjectError("helper_protocol", `${key} is not an integer`);
  }
  return value;
}

function text(message: Json, key: string): string {
  const value = message[key];
  if (typeof value !== "string") {
    throw new JobObjectError("helper_protocol", `${key} is not a string`);
  }
  return value;
}

function nullableString(message: Json, key: string): string | null {
  const value = message[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new JobObjectError("helper_protocol", `${key} is not a string`);
  }
  return value;
}

function flag(message: Json, key: string): boolean {
  const value = message[key];
  if (typeof value !== "boolean") {
    throw new JobObjectError("helper_protocol", `${key} is not a boolean`);
  }
  return value;
}

function optionalCpu(message: Json): number | null {
  const value = integer(message, "cpuRatePercent");
  return value > 0 ? value : null;
}
