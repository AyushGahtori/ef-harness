import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PollSubprocessGuard } from "./poll-guard.js";
import type { ActiveJobSlot } from "./types.js";
import { TelemetryError } from "./types.js";

const CSC = "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe";

export interface HelperMemory {
  readonly ok: boolean;
  readonly totalPhys: number;
  readonly availPhys: number;
  readonly totalPage: number;
  readonly availPage: number;
  readonly load: number;
  readonly error: string | null;
}

export interface HelperVolume {
  readonly ok: boolean;
  readonly path: string;
  readonly free: number;
  readonly total: number;
  readonly error: string | null;
}

export interface HelperSample {
  readonly memory: HelperMemory;
  readonly lowMemory: boolean;
  readonly lowMemoryOk: boolean;
  readonly disk: {
    readonly workspace: HelperVolume;
    readonly appData: HelperVolume;
    readonly queueLength: number | null;
    readonly ioBusyPercent: number | null;
    readonly queueOk: boolean;
  };
  readonly gpu: {
    readonly ok: boolean;
    readonly available: boolean;
    readonly adapterName: string | null;
    readonly budgetBytes: number | null;
    readonly currentUsageBytes: number | null;
    readonly availableForReservationBytes: number | null;
    readonly sharedVramBudgetBytes: number | null;
    readonly error: string | null;
  };
  readonly defender: {
    readonly ok: boolean;
    readonly cpuPercent: number;
    readonly accessDenied: boolean;
    readonly found: boolean;
    readonly error: string | null;
  };
  readonly jobs: readonly HelperJob[];
}

export interface HelperJob {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly ok: boolean;
  readonly peakJobMemoryUsed: number;
  readonly currentWorkingSet: number;
  readonly totalUserTimeMs: number;
  readonly totalKernelTimeMs: number;
  readonly activeProcesses: number;
  readonly win32: number;
  readonly error: string | null;
}

export interface HelperProbeJob {
  readonly name: string;
  readonly jobId: string;
  readonly pid: number;
}

type Json = Record<string, unknown>;

let compiledHelper: Promise<string> | undefined;

export function win32HelperExecutable(guard: PollSubprocessGuard): Promise<string> {
  compiledHelper ??= compileHelper(guard);
  return compiledHelper;
}

async function compileHelper(guard: PollSubprocessGuard): Promise<string> {
  const sourcePath = helperSourcePath();
  const source = fs.readFileSync(sourcePath);
  const hash = createHash("sha256").update(source).digest("hex").slice(0, 16);
  const directory = path.join(os.tmpdir(), "ef-harness-governor-telemetry");
  fs.mkdirSync(directory, { recursive: true });
  const executable = path.join(directory, `${hash}.exe`);
  if (fs.existsSync(executable)) return executable;
  if (!fs.existsSync(CSC)) {
    throw new TelemetryError("helper_compile", `C# compiler is not available at ${CSC}`);
  }
  guard.recordStart(CSC);
  const result = spawnSync(
    CSC,
    ["/nologo", "/platform:x64", "/optimize+", "/r:System.Web.Extensions.dll", `/out:${executable}`, sourcePath],
    { encoding: "utf8", windowsHide: true },
  );
  if (result.status !== 0 || !fs.existsSync(executable)) {
    throw new TelemetryError(
      "helper_compile",
      `telemetry helper compile failed\n${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim(),
    );
  }
  return executable;
}

function helperSourcePath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "win32-helper.cs"),
    path.join(here, "..", "..", "src", "telemetry", "win32-helper.cs"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new TelemetryError("helper_source", "win32-helper.cs is not next to the telemetry collector");
}

export class Win32HelperClient {
  readonly executable: string;
  readonly guard: PollSubprocessGuard;
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly waiters: Array<(message: Json) => void> = [];
  private readonly lowMemoryListeners = new Set<(signaled: boolean) => void>();
  private buffer = "";
  private stderr = "";
  private dead: Error | null = null;
  private nextId = 1;
  private tail: Promise<void> = Promise.resolve();

  private constructor(child: ChildProcessWithoutNullStreams, executable: string, guard: PollSubprocessGuard) {
    this.child = child;
    this.executable = executable;
    this.guard = guard;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      this.onStdout(chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-4000);
    });
    child.on("error", (error) => {
      this.fail(error);
    });
    child.on("exit", (code) => {
      this.fail(new TelemetryError("helper_exit", `telemetry helper exited (${code ?? "signal"}): ${this.stderr}`));
    });
  }

  static async connect(guard = new PollSubprocessGuard()): Promise<Win32HelperClient> {
    const executable = await win32HelperExecutable(guard);
    guard.recordStart(executable);
    const child = spawn(executable, [String(process.pid)], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const client = new Win32HelperClient(child, executable, guard);
    const ping = await client.request({ op: "ping" });
    const extended = ping["extended"];
    if (extended !== 144) {
      await client.close();
      throw new TelemetryError("helper_layout", `job extended-limit layout is ${String(extended)}, expected 144`);
    }
    return client;
  }

  onLowMemory(listener: (signaled: boolean) => void): () => void {
    this.lowMemoryListeners.add(listener);
    return () => {
      this.lowMemoryListeners.delete(listener);
    };
  }

  sample(input: {
    readonly workspace: string;
    readonly appData: string;
    readonly jobs: readonly ActiveJobSlot[];
  }): Promise<HelperSample> {
    return this.request({
      op: "sample",
      workspace: input.workspace,
      appData: input.appData,
      jobs: input.jobs.map((job) => ({ id: job.id, name: job.name, role: job.role })),
    }).then((message) => readSample(message));
  }

  createProbeJob(): Promise<HelperProbeJob> {
    return this.request({ op: "createProbeJob" }).then((message) => ({
      name: text(message, "name"),
      jobId: text(message, "jobId"),
      pid: integer(message, "pid"),
    }));
  }

  closeProbeJob(): Promise<void> {
    return this.request({ op: "closeProbeJob" }).then(() => undefined);
  }

  async close(): Promise<void> {
    if (this.dead || this.child.killed) return;
    try {
      await this.request({ op: "shutdown" });
    } catch {
      if (!this.child.killed) this.child.kill();
    }
  }

  private request(fields: Record<string, unknown>): Promise<Json> {
    this.guard.enterSample();
    const run = this.tail.then(() => this.requestNow(fields));
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run.finally(() => {
      this.guard.exitSample();
    });
  }

  private requestNow(fields: Record<string, unknown>): Promise<Json> {
    if (this.dead) return Promise.reject(this.dead);
    const id = this.nextId;
    this.nextId += 1;
    const line = `${JSON.stringify({ ...fields, id })}\n`;
    return new Promise<Json>((resolve, reject) => {
      let settled = false;
      const waiter = (message: Json): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (message["id"] !== id) {
          const detail = typeof message["error"] === "string" ? message["error"] : "telemetry helper failed";
          reject(new TelemetryError("helper_protocol", detail));
          return;
        }
        if (message["ok"] !== true) {
          const detail = typeof message["error"] === "string" ? message["error"] : "helper request failed";
          reject(new TelemetryError("helper_request", detail));
          return;
        }
        resolve(message);
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(
          new TelemetryError(
            "helper_timeout",
            `telemetry helper timed out on ${String(fields["op"])}: ${this.stderr}`,
          ),
        );
      }, 5000);
      this.waiters.push(waiter);
      this.child.stdin.write(line, (error) => {
        if (!error) return;
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new TelemetryError("helper_stdin", error.message));
      });
    });
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    while (true) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let message: Json;
      try {
        message = parseObject(line);
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error("invalid helper response"));
        return;
      }
      if (message["event"] === "low-memory") {
        const signaled = message["signaled"] === true;
        for (const listener of this.lowMemoryListeners) listener(signaled);
        continue;
      }
      const waiter = this.waiters.shift();
      if (!waiter) {
        this.fail(new TelemetryError("helper_protocol", `unexpected helper response: ${line}`));
        return;
      }
      waiter(message);
    }
  }

  private fail(error: Error): void {
    if (!this.dead) this.dead = error;
    const waiters = this.waiters.splice(0);
    for (const waiter of waiters) waiter({ id: -1, ok: false, error: error.message });
  }
}

function parseObject(line: string): Json {
  const parsed: unknown = JSON.parse(line);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TelemetryError("helper_protocol", "helper response is not an object");
  }
  return parsed as Json;
}

function readSample(message: Json): HelperSample {
  return {
    memory: readMemory(record(message, "memory")),
    lowMemory: flag(message, "lowMemory"),
    lowMemoryOk: flag(message, "lowMemoryOk"),
    disk: readDisk(record(message, "disk")),
    gpu: readGpu(record(message, "gpu")),
    defender: readDefender(record(message, "defender")),
    jobs: readJobs(message["jobs"]),
  };
}

function readMemory(message: Json): HelperMemory {
  return {
    ok: flag(message, "ok"),
    totalPhys: integer(message, "totalPhys"),
    availPhys: integer(message, "availPhys"),
    totalPage: integer(message, "totalPage"),
    availPage: integer(message, "availPage"),
    load: integer(message, "load"),
    error: nullableText(message, "error"),
  };
}

function readDisk(message: Json): HelperSample["disk"] {
  return {
    workspace: readVolume(record(message, "workspace")),
    appData: readVolume(record(message, "appData")),
    queueLength: nullableNumber(message, "queueLength"),
    ioBusyPercent: nullableNumber(message, "ioBusyPercent"),
    queueOk: flag(message, "queueOk"),
  };
}

function readVolume(message: Json): HelperVolume {
  return {
    ok: flag(message, "ok"),
    path: text(message, "path"),
    free: integer(message, "free"),
    total: integer(message, "total"),
    error: nullableText(message, "error"),
  };
}

function readGpu(message: Json): HelperSample["gpu"] {
  return {
    ok: flag(message, "ok"),
    available: flag(message, "available"),
    adapterName: nullableText(message, "adapterName"),
    budgetBytes: nullableInteger(message, "budgetBytes"),
    currentUsageBytes: nullableInteger(message, "currentUsageBytes"),
    availableForReservationBytes: nullableInteger(message, "availableForReservationBytes"),
    sharedVramBudgetBytes: nullableInteger(message, "sharedVramBudgetBytes"),
    error: nullableText(message, "error"),
  };
}

function readDefender(message: Json): HelperSample["defender"] {
  return {
    ok: flag(message, "ok"),
    cpuPercent: number(message, "cpuPercent"),
    accessDenied: flag(message, "accessDenied"),
    found: flag(message, "found"),
    error: nullableText(message, "error"),
  };
}

function readJobs(value: unknown): readonly HelperJob[] {
  if (!Array.isArray(value)) throw new TelemetryError("helper_protocol", "jobs is missing");
  return value.map((entry) => {
    const message = asRecord(entry, "job");
    return {
      id: text(message, "id"),
      name: text(message, "name"),
      role: text(message, "role"),
      ok: flag(message, "ok"),
      peakJobMemoryUsed: integer(message, "peakJobMemoryUsed"),
      currentWorkingSet: integer(message, "currentWorkingSet"),
      totalUserTimeMs: integer(message, "totalUserTimeMs"),
      totalKernelTimeMs: integer(message, "totalKernelTimeMs"),
      activeProcesses: integer(message, "activeProcesses"),
      win32: integer(message, "win32"),
      error: nullableText(message, "error"),
    };
  });
}

function record(message: Json, key: string): Json {
  return asRecord(message[key], key);
}

function asRecord(value: unknown, label: string): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TelemetryError("helper_protocol", `${label} is not an object`);
  }
  return value as Json;
}

function integer(message: Json, key: string): number {
  const value = message[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new TelemetryError("helper_protocol", `${key} is not an integer`);
  }
  return value;
}

function number(message: Json, key: string): number {
  const value = message[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TelemetryError("helper_protocol", `${key} is not a finite number`);
  }
  return value;
}

function text(message: Json, key: string): string {
  const value = message[key];
  if (typeof value !== "string") throw new TelemetryError("helper_protocol", `${key} is not a string`);
  return value;
}

function nullableText(message: Json, key: string): string | null {
  const value = message[key];
  if (value === null) return null;
  if (typeof value === "string") return value;
  throw new TelemetryError("helper_protocol", `${key} is not a string or null`);
}

function nullableInteger(message: Json, key: string): number | null {
  const value = message[key];
  if (value === null) return null;
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  throw new TelemetryError("helper_protocol", `${key} is not an integer or null`);
}

function nullableNumber(message: Json, key: string): number | null {
  const value = message[key];
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new TelemetryError("helper_protocol", `${key} is not a number or null`);
}

function flag(message: Json, key: string): boolean {
  const value = message[key];
  if (typeof value !== "boolean") throw new TelemetryError("helper_protocol", `${key} is not a boolean`);
  return value;
}
