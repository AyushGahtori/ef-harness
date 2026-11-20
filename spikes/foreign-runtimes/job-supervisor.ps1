$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::ASCII

$source = @"
using System;
using System.Runtime.InteropServices;

public static class EfHarnessJob {
    const int JobObjectExtendedLimitInformation = 9;
    const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
    const uint PROCESS_TERMINATE = 0x0001;
    const uint PROCESS_SET_QUOTA = 0x0100;

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
        public BasicLimits Basic;
        public IoCounters Io;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateJobObject(IntPtr attributes, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool TerminateJobObject(IntPtr job, uint exitCode);

    static IntPtr job = IntPtr.Zero;

    public static string Create() {
        job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) return "ERR create " + Marshal.GetLastWin32Error();
        ExtendedLimits info = new ExtendedLimits();
        info.Basic.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        int size = Marshal.SizeOf(typeof(ExtendedLimits));
        IntPtr ptr = Marshal.AllocHGlobal(size);
        try {
            Marshal.StructureToPtr(info, ptr, false);
            if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, ptr, (uint)size)) {
                Console.Error.WriteLine("job limit " + Marshal.GetLastWin32Error());
            }
        } finally {
            Marshal.FreeHGlobal(ptr);
        }
        return "OK";
    }

    public static string Assign(uint pid) {
        if (job == IntPtr.Zero) return "ERR nojob";
        IntPtr handle = OpenProcess(PROCESS_TERMINATE | PROCESS_SET_QUOTA, false, pid);
        if (handle == IntPtr.Zero) return "ERR open " + Marshal.GetLastWin32Error();
        try {
            if (!AssignProcessToJobObject(job, handle)) return "ERR assign " + Marshal.GetLastWin32Error();
            return "OK";
        } finally {
            CloseHandle(handle);
        }
    }

    public static string Kill() {
        if (job == IntPtr.Zero) return "OK";
        TerminateJobObject(job, 1);
        CloseHandle(job);
        job = IntPtr.Zero;
        return "OK";
    }

    public static string CloseJob() {
        if (job == IntPtr.Zero) return "OK";
        CloseHandle(job);
        job = IntPtr.Zero;
        return "OK";
    }
}
"@

Add-Type -TypeDefinition $source -Language CSharp
[Console]::WriteLine([EfHarnessJob]::Create())
[Console]::Out.Flush()

while ($true) {
    $line = [Console]::ReadLine()
    if ($null -eq $line) {
        [EfHarnessJob]::CloseJob() | Out-Null
        break
    }
    if ($line -eq "KILL") {
        [Console]::WriteLine([EfHarnessJob]::Kill())
        [Console]::Out.Flush()
        break
    }
    if ($line -eq "CLOSE") {
        [Console]::WriteLine([EfHarnessJob]::CloseJob())
        [Console]::Out.Flush()
        break
    }
    if ($line.StartsWith("ASSIGN ")) {
        $pidText = $line.Substring(7).Trim()
        $parsed = 0
        if (-not [uint]::TryParse($pidText, [ref]$parsed)) {
            [Console]::WriteLine("ERR pid")
        } else {
            [Console]::WriteLine([EfHarnessJob]::Assign($parsed))
        }
        [Console]::Out.Flush()
        continue
    }
    [Console]::WriteLine("ERR command")
    [Console]::Out.Flush()
}
