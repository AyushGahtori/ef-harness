# Holds no long-lived job handle. The parent process owns the only durable handle.
# KILL_ON_JOB_CLOSE therefore runs when that parent is terminated or asks for release.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

public static class EfJob {
  const uint CREATE_SUSPENDED = 0x00000004;
  const uint CREATE_NO_WINDOW = 0x08000000;
  const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
  const int JobObjectBasicLimitInformation = 2;
  const uint PROCESS_SET_QUOTA = 0x0100;
  const uint PROCESS_TERMINATE = 0x0001;
  const uint PROCESS_DUP_HANDLE = 0x0040;
  const uint DUPLICATE_SAME_ACCESS = 0x00000002;
  const uint DUPLICATE_CLOSE_SOURCE = 0x00000001;
  const uint JOB_OBJECT_ALL_ACCESS = 0x1F001F;
  const uint GENERIC_WRITE = 0x40000000;
    const uint FILE_SHARE_READ_WRITE = 0x00000003;
  const uint CREATE_ALWAYS = 2;
  const uint FILE_ATTRIBUTE_NORMAL = 0x00000080;
  const int STARTF_USESTDHANDLES = 0x00000100;
  static readonly IntPtr InvalidHandle = new IntPtr(-1);

  static string jobName;
  static int parentPid;
  static long parentHandleValue;

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct STARTUPINFO {
    public int cb;
    public string lpReserved;
    public string lpDesktop;
    public string lpTitle;
    public int dwX;
    public int dwY;
    public int dwXSize;
    public int dwYSize;
    public int dwXCountChars;
    public int dwYCountChars;
    public int dwFillAttribute;
    public int dwFlags;
    public short wShowWindow;
    public short cbReserved2;
    public IntPtr lpReserved2;
    public IntPtr hStdInput;
    public IntPtr hStdOutput;
    public IntPtr hStdError;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct PROCESS_INFORMATION {
    public IntPtr hProcess;
    public IntPtr hThread;
    public int dwProcessId;
    public int dwThreadId;
  }

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern IntPtr CreateJobObject(IntPtr attrs, string name);

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern IntPtr OpenJobObject(uint access, bool inherit, string name);

  [DllImport("kernel32.dll", EntryPoint = "SetInformationJobObject", SetLastError = true)]
  static extern bool SetInformationJobObjectRaw(IntPtr job, int infoClass, IntPtr info, uint length);

  static bool TrySetKillOnJobClose(IntPtr created) {
    int[] sizes = new int[] { 64, 48, 72, 144 };
    int lastError = 0;
    foreach (int size in sizes) {
      IntPtr mem = Marshal.AllocHGlobal(size);
      try {
        for (int i = 0; i < size; i++) Marshal.WriteByte(mem, i, 0);
        Marshal.WriteInt32(mem, 16, unchecked((int)JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE));
        int infoClass = size == 144 ? 9 : JobObjectBasicLimitInformation;
        if (SetInformationJobObjectRaw(created, infoClass, mem, (uint)size)) return true;
        lastError = Marshal.GetLastWin32Error();
      } finally {
        Marshal.FreeHGlobal(mem);
      }
    }
    throw new Win32Exception(lastError, "SetInformationJobObject KILL_ON_JOB_CLOSE failed win32=" + lastError.ToString());
  }

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern IntPtr OpenProcess(uint access, bool inherit, int pid);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool CloseHandle(IntPtr handle);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool DuplicateHandle(IntPtr srcProc, IntPtr src, IntPtr dstProc, out IntPtr dst, uint access, bool inherit, uint options);

  [DllImport("kernel32.dll")]
  static extern IntPtr GetCurrentProcess();

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CreateProcess(string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern uint ResumeThread(IntPtr thread);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool TerminateProcess(IntPtr process, uint code);

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern IntPtr CreateFile(string name, uint access, uint share, IntPtr sa, uint disp, uint flags, IntPtr template);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);

  [DllImport("kernel32.dll")]
  static extern int GetCurrentProcessId();

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool GetExitCodeProcess(IntPtr process, out uint code);

  const uint HANDLE_FLAG_INHERIT = 0x00000001;
  const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
  const uint STILL_ACTIVE = 259;

  public static string Init(int pid) {
    parentPid = pid;
    jobName = "Local\\EFHarnessSpike-" + pid.ToString() + "-" + Guid.NewGuid().ToString("N");
    IntPtr created = CreateJobObject(IntPtr.Zero, jobName);
    if (created == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateJobObject failed");
    try {
      if (!TrySetKillOnJobClose(created)) {
        throw new Win32Exception(Marshal.GetLastWin32Error(), "SetInformationJobObject KILL_ON_JOB_CLOSE failed");
      }
      IntPtr parent = OpenProcess(PROCESS_DUP_HANDLE, false, pid);
      if (parent == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "OpenProcess for handle duplication failed");
      IntPtr duplicated;
      bool copied = DuplicateHandle(GetCurrentProcess(), created, parent, out duplicated, 0, false, DUPLICATE_SAME_ACCESS);
      int copyError = Marshal.GetLastWin32Error();
      CloseHandle(parent);
      if (!copied) throw new Win32Exception(copyError, "DuplicateHandle into the parent failed");
      parentHandleValue = duplicated.ToInt64();
    } finally {
      CloseHandle(created);
    }
    StartParentWatch();
    return jobName;
  }

  static void StartParentWatch() {
    int watched = parentPid;
    System.Threading.Thread thread = new System.Threading.Thread(() => {
      while (true) {
        System.Threading.Thread.Sleep(200);
        IntPtr parent = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, watched);
        if (parent == IntPtr.Zero) Environment.Exit(0);
        uint code;
        bool read = GetExitCodeProcess(parent, out code);
        CloseHandle(parent);
        if (!read || code != STILL_ACTIVE) Environment.Exit(0);
      }
    });
    thread.IsBackground = true;
    thread.Start();
  }

  public static void Assign(int pid) {
    IntPtr owned = OpenOwnedJob();
    try {
      IntPtr process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid);
      if (process == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "OpenProcess failed for pid " + pid.ToString());
      try {
        if (!AssignProcessToJobObject(owned, process)) {
          throw new Win32Exception(Marshal.GetLastWin32Error(), "AssignProcessToJobObject failed for pid " + pid.ToString());
        }
      } finally {
        CloseHandle(process);
      }
    } finally {
      CloseHandle(owned);
    }
  }

  public static int Spawn(string application, string commandLine, string cwd, string stdoutPath, string stderrPath) {
    STARTUPINFO si = new STARTUPINFO();
    si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
    IntPtr stdout = IntPtr.Zero;
    IntPtr stderr = IntPtr.Zero;
    bool inherit = false;
    if (!string.IsNullOrEmpty(stdoutPath) || !string.IsNullOrEmpty(stderrPath)) {
      if (!string.IsNullOrEmpty(stdoutPath)) stdout = OpenLog(stdoutPath);
      if (!string.IsNullOrEmpty(stderrPath) && stderrPath != stdoutPath) stderr = OpenLog(stderrPath);
      si.dwFlags = STARTF_USESTDHANDLES;
      si.hStdOutput = stdout;
      si.hStdError = stderr == IntPtr.Zero ? stdout : stderr;
      inherit = true;
    }
    PROCESS_INFORMATION pi;
    StringBuilder mutable = new StringBuilder(commandLine);
    bool created = CreateProcess(application, mutable, IntPtr.Zero, IntPtr.Zero, inherit, CREATE_SUSPENDED | CREATE_NO_WINDOW, IntPtr.Zero, string.IsNullOrEmpty(cwd) ? null : cwd, ref si, out pi);
    int createError = Marshal.GetLastWin32Error();
    if (stdout != IntPtr.Zero) CloseHandle(stdout);
    if (stderr != IntPtr.Zero) CloseHandle(stderr);
    if (!created) throw new Win32Exception(createError, "CreateProcess failed for " + application);
    IntPtr owned = OpenOwnedJob();
    try {
      if (!AssignProcessToJobObject(owned, pi.hProcess)) {
        int assignError = Marshal.GetLastWin32Error();
        TerminateProcess(pi.hProcess, 1);
        CloseHandle(pi.hThread);
        CloseHandle(pi.hProcess);
        throw new Win32Exception(assignError, "AssignProcessToJobObject failed for " + application);
      }
    } finally {
      CloseHandle(owned);
    }
    uint resumed = ResumeThread(pi.hThread);
    int resumeError = Marshal.GetLastWin32Error();
    int child = pi.dwProcessId;
    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);
    if (resumed == 0xFFFFFFFF) throw new Win32Exception(resumeError, "ResumeThread failed");
    return child;
  }

  public static void EnrollSelf() {
    try {
      IntPtr owned = OpenOwnedJob();
      try {
        IntPtr self = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, GetCurrentProcessId());
        if (self == IntPtr.Zero) return;
        try {
          AssignProcessToJobObject(owned, self);
        } finally {
          CloseHandle(self);
        }
      } finally {
        CloseHandle(owned);
      }
    } catch (Win32Exception) {
      // The holder also watches the parent and exits when that process dies.
    }
  }

  public static void Release() {
    IntPtr parent = OpenProcess(PROCESS_DUP_HANDLE, false, parentPid);
    if (parent == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "OpenProcess failed during release");
    IntPtr local;
    bool closed = DuplicateHandle(parent, new IntPtr(parentHandleValue), GetCurrentProcess(), out local, 0, false, DUPLICATE_CLOSE_SOURCE);
    int error = Marshal.GetLastWin32Error();
    CloseHandle(parent);
    if (!closed) throw new Win32Exception(error, "Failed to close the parent job handle");
    CloseHandle(local);
  }

  static IntPtr OpenOwnedJob() {
    IntPtr opened = OpenJobObject(JOB_OBJECT_ALL_ACCESS, false, jobName);
    if (opened == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "OpenJobObject failed");
    return opened;
  }

  static IntPtr OpenLog(string path) {
    IntPtr handle = CreateFile(path, GENERIC_WRITE, FILE_SHARE_READ_WRITE, IntPtr.Zero, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, IntPtr.Zero);
    if (handle == InvalidHandle) throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateFile failed for " + path + " win32=" + Marshal.GetLastWin32Error().ToString());
    if (!SetHandleInformation(handle, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT)) {
      int error = Marshal.GetLastWin32Error();
      CloseHandle(handle);
      throw new Win32Exception(error, "SetHandleInformation failed for " + path);
    }
    return handle;
  }
}
'@

function Write-Msg([hashtable]$Message) {
  $json = $Message | ConvertTo-Json -Compress -Depth 8
  [Console]::Out.WriteLine($json)
  [Console]::Out.Flush()
}

function Text-OrEmpty($Value) {
  if ($null -eq $Value) { return "" }
  return [string]$Value
}

try {
  while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $msg = $line | ConvertFrom-Json
    $op = [string]$msg.op
    switch ($op) {
      "init" {
        $name = [EfJob]::Init([int]$msg.parentPid)
        Write-Msg @{ ok = $true; op = "init"; jobName = $name }
      }
      "assign" {
        [EfJob]::Assign([int]$msg.pid)
        Write-Msg @{ ok = $true; op = "assign"; pid = [int]$msg.pid }
      }
      "spawn" {
        $childPid = [EfJob]::Spawn(
          (Text-OrEmpty $msg.application),
          (Text-OrEmpty $msg.commandLine),
          (Text-OrEmpty $msg.cwd),
          (Text-OrEmpty $msg.stdoutPath),
          (Text-OrEmpty $msg.stderrPath)
        )
        Write-Msg @{ ok = $true; op = "spawn"; pid = $childPid }
      }
      "enroll-self" {
        [EfJob]::EnrollSelf()
        Write-Msg @{ ok = $true; op = "enroll-self" }
      }
      "release" {
        Write-Msg @{ ok = $true; op = "release" }
        [EfJob]::Release()
        break
      }
      "ping" {
        Write-Msg @{ ok = $true; op = "ping" }
      }
      default {
        Write-Msg @{ ok = $false; op = $op; error = "unknown op" }
      }
    }
  }
} catch {
  $reason = $_.Exception.Message
  [Console]::Error.WriteLine($reason)
  Write-Msg @{ ok = $false; op = "error"; error = $reason }
  exit 1
}
