import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Win32 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. */
export const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;

export const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE_NAME = "JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE" as const;

export interface JobLimits {
  readonly killOnJobClose: true;
  readonly jobMemoryBytes?: number;
  readonly activeProcessLimit?: number;
}

export interface JobHandle {
  readonly id: string;
  readonly name: string;
  readonly limits: JobLimits;
  readonly killOnCloseFlag: typeof JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE_NAME;
  readonly nativeLimit: typeof JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
}

export interface JobAccounting {
  readonly activeProcesses: number;
  readonly pids: readonly number[];
  readonly native: boolean;
}

/**
 * Consumer port for Task 040's `WindowsJobManager`.
 * Every backing-service child is assigned only when the job carries
 * `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`.
 */
export interface WindowsJobManager {
  createJob(name: string, limits: JobLimits): Promise<JobHandle>;
  assignProcess(job: JobHandle, pid: number): Promise<void>;
  queryJobAccounting(job: JobHandle): Promise<JobAccounting>;
  terminateJob(job: JobHandle): Promise<void>;
}

interface LiveJob {
  handle: JobHandle;
  pids: Set<number>;
  nativePids: Set<number>;
  host: NativeJobHost | null;
  nativeError: string | null;
}

/**
 * On Windows this opens a real Job Object with kill-on-close and assigns
 * child PIDs into it. Closing the holder drops the last handle, so Windows
 * kills every assigned process even if this parent dies.
 * Other platforms track PIDs and terminate them explicitly.
 */
export class TrackingWindowsJobManager implements WindowsJobManager {
  readonly assignments: { jobId: string; pid: number }[] = [];
  private readonly jobs = new Map<string, LiveJob>();

  async createJob(name: string, limits: JobLimits): Promise<JobHandle> {
    if (limits.killOnJobClose !== true) {
      throw new Error(`${JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE_NAME} is required`);
    }
    const handle: JobHandle = {
      id: randomUUID(),
      name,
      limits,
      killOnCloseFlag: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE_NAME,
      nativeLimit: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    this.jobs.set(handle.id, { handle, pids: new Set(), nativePids: new Set(), host: null, nativeError: null });
    return handle;
  }

  async assignProcess(job: JobHandle, pid: number): Promise<void> {
    assertKillOnClose(job);
    if (!Number.isInteger(pid) || pid <= 0) {
      throw new Error(`refusing to assign an invalid pid ${pid}`);
    }
    const live = this.lookup(job);
    if (process.platform === "win32") {
      try {
        if (!live.host) live.host = await NativeJobHost.start();
        await live.host.assign(pid);
        live.nativePids.add(pid);
      } catch (error) {
        live.nativeError = error instanceof Error ? error.message : String(error);
      }
    }
    live.pids.add(pid);
    this.assignments.push({ jobId: job.id, pid });
  }

  async queryJobAccounting(job: JobHandle): Promise<JobAccounting> {
    const live = this.lookup(job);
    return {
      activeProcesses: live.pids.size,
      pids: [...live.pids],
      native: live.nativePids.size > 0,
    };
  }

  private lookup(job: JobHandle): LiveJob {
    const live = this.jobs.get(job.id);
    if (!live) throw new Error(`unknown job ${job.name}`);
    return live;
  }

  async terminateJob(job: JobHandle): Promise<void> {
    const live = this.jobs.get(job.id);
    if (!live) return;
    const host = live.host;
    live.host = null;
    if (host) await host.close();
    for (const pid of live.pids) {
      if (!live.nativePids.has(pid)) signalPid(pid);
    }
    live.pids.clear();
    this.jobs.delete(job.id);
  }
}

function assertKillOnClose(job: JobHandle): void {
  if (
    job.limits.killOnJobClose !== true ||
    job.killOnCloseFlag !== JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE_NAME ||
    job.nativeLimit !== JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
  ) {
    throw new Error(
      `refusing to assign a process to a job without ${JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE_NAME}`,
    );
  }
}

function signalPid(pid: number): void {
  try {
    process.kill(pid);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : "";
    if (code === "ESRCH") return;
    throw error;
  }
}

export function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : "";
    if (code === "ESRCH") return false;
    throw error;
  }
}

class NativeJobHost {
  private buffered = "";
  private readonly waiters: Array<(line: string) => void> = [];
  private stderr = "";

  private constructor(
    private readonly child: ChildProcess,
    private readonly scriptDir: string,
  ) {
    this.child.stdout?.setEncoding("utf8");
    this.child.stderr?.setEncoding("utf8");
    this.child.stdout?.on("data", (chunk: string | Buffer) => {
      this.buffered += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      this.drain();
    });
    this.child.stderr?.on("data", (chunk: string | Buffer) => {
      this.stderr += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    });
    this.child.on("error", () => undefined);
  }

  static async start(): Promise<NativeJobHost> {
    const scriptDir = await mkdtemp(path.join(os.tmpdir(), "ef-job-"));
    const scriptPath = path.join(scriptDir, "job-host.ps1");
    await writeFile(scriptPath, JOB_HOST_SCRIPT, "utf8");
    const executable = path.join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    const child = spawn(
      executable,
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
      { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    );
    const host = new NativeJobHost(child, scriptDir);
    try {
      const line = await host.readLine(20_000);
      if (line !== "ready") {
        throw new Error(`job host failed to open: ${line}\n${host.stderr}`);
      }
    } catch (error) {
      host.child.kill();
      await rm(scriptDir, { recursive: true, force: true });
      throw error;
    }
    return host;
  }

  async assign(pid: number): Promise<void> {
    this.child.stdin?.write(`assign ${pid}\n`);
    const line = await this.readLine(10_000);
    if (line !== `assigned ${pid}`) {
      throw new Error(`Job Object assignment failed for pid ${pid}: ${line}\n${this.stderr}`);
    }
  }

  async close(): Promise<void> {
    if (this.child.stdin?.writable) {
      this.child.stdin.write("close\n");
      this.child.stdin.end();
    }
    await new Promise<void>((resolve) => {
      if (this.child.exitCode !== null || this.child.signalCode !== null) {
        resolve();
        return;
      }
      this.child.once("exit", () => resolve());
      setTimeout(() => {
        this.child.kill();
        resolve();
      }, 3_000).unref();
    });
    await rm(this.scriptDir, { recursive: true, force: true });
  }

  private readLine(timeoutMs: number): Promise<string> {
    const queued = this.takeLine();
    if (queued !== null) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(deliver);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error(`timed out waiting for job host\n${this.stderr}`));
      }, timeoutMs);
      const deliver = (line: string): void => {
        clearTimeout(timer);
        resolve(line);
      };
      this.waiters.push(deliver);
      this.drain();
    });
  }

  private drain(): void {
    while (this.waiters.length > 0) {
      const line = this.takeLine();
      if (line === null) return;
      const waiter = this.waiters.shift();
      waiter?.(line);
    }
  }

  private takeLine(): string | null {
    while (true) {
      const newline = this.buffered.indexOf("\n");
      if (newline < 0) return null;
      const line = this.buffered.slice(0, newline).trim();
      this.buffered = this.buffered.slice(newline + 1);
      if (line.length > 0) return line;
    }
  }
}

const JOB_HOST_SCRIPT = `
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false
$code = @"
using System;
using System.Runtime.InteropServices;
public class EfHarnessJob {
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern IntPtr CreateJobObject(IntPtr attr, string name);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool CloseHandle(IntPtr handle);
  [StructLayout(LayoutKind.Sequential)]
  public struct Basic {
    public long PerProcessUserTimeLimit;
    public long PerJobUserTimeLimit;
    public uint LimitFlags;
    public UIntPtr MinimumWorkingSetSize;
    public UIntPtr MaximumWorkingSetSize;
    public uint ActiveProcessLimit;
    public UIntPtr Affinity;
    public uint PriorityClass;
    public uint SchedulingClass;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct IoCounters {
    public ulong ReadOperationCount;
    public ulong WriteOperationCount;
    public ulong OtherOperationCount;
    public ulong ReadTransferCount;
    public ulong WriteTransferCount;
    public ulong OtherTransferCount;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct Extended {
    public Basic BasicLimitInformation;
    public IoCounters IoInfo;
    public UIntPtr ProcessMemoryLimit;
    public UIntPtr JobMemoryLimit;
    public UIntPtr PeakProcessMemoryUsed;
    public UIntPtr PeakJobMemoryUsed;
  }
  public static IntPtr Handle;
  public static bool Open() {
    Handle = CreateJobObject(IntPtr.Zero, null);
    Extended info = new Extended();
    info.BasicLimitInformation.LimitFlags = 0x2000;
    int size = Marshal.SizeOf(typeof(Extended));
    IntPtr ptr = Marshal.AllocHGlobal(size);
    Marshal.StructureToPtr(info, ptr, false);
    bool ok = SetInformationJobObject(Handle, 9, ptr, (uint)size);
    Marshal.FreeHGlobal(ptr);
    return Handle != IntPtr.Zero && ok;
  }
  public static bool Assign(int procId) {
    IntPtr proc = OpenProcess(0x1F0FFF, false, procId);
    if (proc == IntPtr.Zero) return false;
    bool ok = AssignProcessToJobObject(Handle, proc);
    CloseHandle(proc);
    return ok;
  }
  public static void Release() {
    if (Handle != IntPtr.Zero) {
      CloseHandle(Handle);
      Handle = IntPtr.Zero;
    }
  }
}
"@
Add-Type -TypeDefinition $code | Out-Null
if (-not [EfHarnessJob]::Open()) {
  [Console]::Error.WriteLine("job-open-failed")
  exit 1
}
[Console]::Out.WriteLine("ready")
[Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line -or $line -eq "close") { break }
  if ($line.StartsWith("assign ")) {
    $procId = 0
    if (-not [int]::TryParse($line.Substring(7).Trim(), [ref]$procId)) {
      [Console]::Out.WriteLine("error parse")
      [Console]::Out.Flush()
      continue
    }
    if ([EfHarnessJob]::Assign($procId)) {
      [Console]::Out.WriteLine("assigned $procId")
    } else {
      [Console]::Out.WriteLine("error $procId")
    }
    [Console]::Out.Flush()
  }
}
[EfHarnessJob]::Release()
exit 0
`;
