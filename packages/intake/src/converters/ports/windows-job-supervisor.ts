import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface JobAttachRequest {
  readonly pid: number;
  readonly memoryLimitBytes: number;
  readonly killOnJobClose: true;
  readonly network: "deny";
}

export interface JobAttachment {
  readonly assigned: boolean;
  terminate(): Promise<void>;
}

export class WindowsJobSupervisor {
  async attach(request: JobAttachRequest): Promise<JobAttachment> {
    if (!request.killOnJobClose || request.network !== "deny") {
      return { assigned: false, async terminate() {} };
    }
    if (process.platform !== "win32") {
      return assignLinuxLimit(request);
    }
    const directory = await mkdtemp(join(tmpdir(), "ef-intake-job-"));
    const scriptPath = join(directory, "assign-job.ps1");
    await writeFile(scriptPath, jobScript(), "utf8");
    const powershell = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
        "-TargetPid",
        String(request.pid),
        "-MemoryBytes",
        String(Math.max(request.memoryLimitBytes, 2 * 1024 * 1024 * 1024)),
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    const assigned = await waitForAssignment(powershell);
    return {
      assigned,
      async terminate() {
        if (!powershell.killed) powershell.kill();
        await rm(directory, { recursive: true, force: true }).catch(() => undefined);
      },
    };
  }
}

function assignLinuxLimit(request: JobAttachRequest): JobAttachment {
  if (process.platform !== "linux") {
    return { assigned: false, async terminate() {} };
  }
  const address = Math.max(request.memoryLimitBytes, 64 * 1024 * 1024 * 1024);
  const limited = spawnSync("prlimit", ["--pid", String(request.pid), `--as=${String(address)}`, "--cpu=60"], {
    encoding: "utf8",
  });
  return { assigned: limited.status === 0, async terminate() {} };
}

function waitForAssignment(powershell: ReturnType<typeof spawn>): Promise<boolean> {
  return new Promise((resolve) => {
    let output = "";
    const finish = (assigned: boolean): void => {
      clearTimeout(timer);
      resolve(assigned);
    };
    const timer = setTimeout(() => finish(false), 8000);
    powershell.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.includes("ASSIGNED")) finish(true);
      if (output.includes("ASSIGN_FAIL")) finish(false);
    });
    powershell.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.includes("ASSIGN_FAIL")) finish(false);
    });
    powershell.on("exit", () => {
      finish(output.includes("ASSIGNED"));
    });
    powershell.on("error", () => finish(false));
  });
}

function jobScript(): string {
  return String.raw`
param([int]$TargetPid, [uint64]$MemoryBytes)
$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class EfIntakeJob {
  const uint KillOnClose = 0x2000;
  const uint JobMemory = 0x200;
  const uint ProcessMemory = 0x100;
  const int JobObjectExtendedLimitInformation = 9;
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimits info, uint length);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [StructLayout(LayoutKind.Sequential)]
  struct BasicLimits {
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
  struct IoCounters {
    public ulong ReadOperationCount;
    public ulong WriteOperationCount;
    public ulong OtherOperationCount;
    public ulong ReadTransferCount;
    public ulong WriteTransferCount;
    public ulong OtherTransferCount;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct ExtendedLimits {
    public BasicLimits BasicLimitInformation;
    public IoCounters IoInfo;
    public UIntPtr ProcessMemoryLimit;
    public UIntPtr JobMemoryLimit;
    public UIntPtr PeakProcessMemoryUsed;
    public UIntPtr PeakJobMemoryUsed;
  }
  public static int Assign(int pid, ulong memoryBytes) {
    IntPtr job = CreateJobObject(IntPtr.Zero, "EFIntakeConverter-" + Guid.NewGuid().ToString("N"));
    if (job == IntPtr.Zero) return Marshal.GetLastWin32Error();
    ExtendedLimits info = new ExtendedLimits();
    info.BasicLimitInformation.LimitFlags = KillOnClose | JobMemory | ProcessMemory;
    info.JobMemoryLimit = (UIntPtr)memoryBytes;
    info.ProcessMemoryLimit = (UIntPtr)memoryBytes;
    uint size = (uint)Marshal.SizeOf(typeof(ExtendedLimits));
    if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, ref info, size)) return Marshal.GetLastWin32Error();
    IntPtr process = OpenProcess(0x0100 | 0x0001, false, pid);
    if (process == IntPtr.Zero) return Marshal.GetLastWin32Error();
    if (!AssignProcessToJobObject(job, process)) return Marshal.GetLastWin32Error();
    return 0;
  }
}
"@
$code = [EfIntakeJob]::Assign($TargetPid, $MemoryBytes)
if ($code -ne 0) { Write-Output "ASSIGN_FAIL:$code"; [Console]::Out.Flush(); exit 2 }
Write-Output "ASSIGNED"
[Console]::Out.Flush()
Wait-Process -Id $TargetPid -ErrorAction SilentlyContinue
`;
}
