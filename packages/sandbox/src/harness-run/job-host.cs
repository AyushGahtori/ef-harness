using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public class JobHostProgram {
  const uint CREATE_SUSPENDED = 0x00000004;
  const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
  const uint CREATE_NO_WINDOW = 0x08000000;
  const int STARTF_USESTDHANDLES = 0x00000100;
  const uint JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 0x00000008;
  const uint JOB_OBJECT_LIMIT_JOB_MEMORY = 0x00000200;
  const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
  const uint GENERIC_READ = 0x80000000;
  const uint GENERIC_WRITE = 0x40000000;
  const uint FILE_APPEND_DATA = 0x00000004;
  const uint FILE_SHARE_READ = 0x00000001;
  const uint FILE_SHARE_WRITE = 0x00000002;
  const uint OPEN_EXISTING = 3;
  const uint CREATE_ALWAYS = 2;
  const uint OPEN_ALWAYS = 4;
  const int JobObjectExtendedLimitInformation = 9;
  const int JobObjectBasicUIRestrictions = 4;
  const int JobObjectBasicAccountingInformation = 1;
  const uint JOB_OBJECT_UILIMIT_HANDLES = 0x00000001;
  const uint JOB_OBJECT_UILIMIT_DESKTOP = 0x00000040;
  const uint JOB_OBJECT_UILIMIT_EXITWINDOWS = 0x00000080;
  const int STD_INPUT_HANDLE = -10;
  const int STD_OUTPUT_HANDLE = -11;
  const int STD_ERROR_HANDLE = -12;

  static readonly object Gate = new object();
  static IntPtr job = IntPtr.Zero;
  static bool killRequested;
  static bool outputLimit;
  static bool timedOut;
  static bool oomKilled;
  static int exitCode = 1;
  static long peakMemory;
  static string error = "";

  [StructLayout(LayoutKind.Sequential)]
  struct SecurityAttributes {
    public int nLength;
    public IntPtr lpSecurityDescriptor;
    [MarshalAs(UnmanagedType.Bool)]
    public bool bInheritHandle;
  }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct StartupInfo {
    public int cb;
    public IntPtr lpReserved;
    public IntPtr lpDesktop;
    public IntPtr lpTitle;
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
  struct ProcessInformation {
    public IntPtr hProcess;
    public IntPtr hThread;
    public int dwProcessId;
    public int dwThreadId;
  }

  [StructLayout(LayoutKind.Explicit, Size = 144)]
  struct ExtendedLimit {
    [FieldOffset(16)] public uint LimitFlags;
    [FieldOffset(40)] public uint ActiveProcessLimit;
    [FieldOffset(120)] public ulong JobMemoryLimit;
    [FieldOffset(136)] public ulong PeakJobMemoryUsed;
  }

  [StructLayout(LayoutKind.Explicit, Size = 48)]
  struct BasicAccounting {
    [FieldOffset(40)] public uint ActiveProcesses;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct UiRestrictions {
    public uint UIRestrictionsClass;
  }

  class Step {
    public string Op = "none";
    public string[] Argv = new string[0];
    public List<Redirect> Redirects = new List<Redirect>();
  }

  class Redirect {
    public string Kind = "";
    public string Target = "";
  }

  class PlanReader {
    readonly string[] lines;
    int cursor;
    public PlanReader(string[] lines) { this.lines = lines; }
    public string Next() {
      if (this.cursor >= this.lines.Length) throw new Exception("execution plan ended early");
      string line = this.lines[this.cursor];
      this.cursor++;
      return line;
    }
    public int NextInt() { return int.Parse(this.Next()); }
    public string NextText() {
      string line = this.Next();
      if (line.Length == 0) return "";
      return Encoding.UTF8.GetString(Convert.FromBase64String(line));
    }
  }

  public static int Main(string[] args) {
    string resultPath = Arg(args, "--result");
    try {
      if (IntPtr.Size != 8) throw new Exception("job host requires a 64-bit process");
      Run(args);
      WriteResult(resultPath);
      return error.Length == 0 ? 0 : 1;
    } catch (Exception ex) {
      error = ex.Message;
      if (resultPath.Length > 0) {
        try { WriteResult(resultPath); } catch (Exception) { }
      }
      return 1;
    }
  }

  static void Run(string[] args) {
    string planPath = Arg(args, "--plan");
    string resultPath = Arg(args, "--result");
    if (planPath.Length == 0 || resultPath.Length == 0) throw new Exception("missing --plan or --result");
    PlanReader reader = new PlanReader(File.ReadAllLines(planPath));
    if (reader.Next() != "EFHPLAN1") throw new Exception("unrecognized execution plan");
    ulong memoryBytes = (ulong)reader.NextInt();
    uint processLimit = (uint)reader.NextInt();
    int timeoutMs = reader.NextInt();
    string cwd = reader.NextText();
    int envCount = reader.NextInt();
    List<string> env = new List<string>();
    for (int i = 0; i < envCount; i++) env.Add(reader.NextText());
    int stepCount = reader.NextInt();
    if (stepCount < 1 || stepCount > 64) throw new Exception("execution plan has no runnable step");
    List<Step> steps = new List<Step>();
    for (int i = 0; i < stepCount; i++) {
      Step step = new Step();
      step.Op = reader.Next();
      int argc = reader.NextInt();
      if (argc < 1 || argc > 256) throw new Exception("execution plan argv is invalid");
      step.Argv = new string[argc];
      for (int a = 0; a < argc; a++) step.Argv[a] = reader.NextText();
      int redirects = reader.NextInt();
      for (int r = 0; r < redirects; r++) {
        Redirect redirect = new Redirect();
        redirect.Kind = reader.Next();
        redirect.Target = reader.NextText();
        step.Redirects.Add(redirect);
      }
      steps.Add(step);
    }
    job = CreateJobObject(IntPtr.Zero, null);
    if (job == IntPtr.Zero) throw new Exception(Win("CreateJobObject"));
    ApplyLimits(memoryBytes, processLimit);
    Thread readerThread = new Thread(new ThreadStart(ReadKill));
    readerThread.IsBackground = true;
    readerThread.Start();
    IntPtr environment = AllocEnv(env);
    IntPtr nul = CreateFile("NUL", GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, IntPtr.Zero, OPEN_EXISTING, 0, IntPtr.Zero);
    Stopwatch clock = Stopwatch.StartNew();
    try {
      int last = 0;
      int index = 0;
      while (index < steps.Count) {
        if (killRequested || timedOut) break;
        Step step = steps[index];
        if (step.Op == "and" && last != 0) { index++; continue; }
        if (step.Op == "or" && last == 0) { index++; continue; }
        List<Step> group = new List<Step>();
        group.Add(step);
        int next = index + 1;
        while (next < steps.Count && steps[next].Op == "pipe") {
          group.Add(steps[next]);
          next++;
        }
        last = RunGroup(group, cwd, environment, nul, clock, timeoutMs);
        exitCode = last;
        index = next;
      }
    } finally {
      if (environment != IntPtr.Zero) Marshal.FreeHGlobal(environment);
      KillJob();
      WaitForQuiet();
      peakMemory = QueryPeak();
      if (!timedOut && !outputLimit && peakMemory > 0 && memoryBytes > 0 && (ulong)peakMemory >= memoryBytes && exitCode != 0) {
        oomKilled = true;
      }
      if (nul != IntPtr.Zero && nul != new IntPtr(-1)) CloseHandle(nul);
      if (job != IntPtr.Zero) {
        CloseHandle(job);
        job = IntPtr.Zero;
      }
    }
  }

  static int RunGroup(List<Step> group, string cwd, IntPtr environment, IntPtr nul, Stopwatch clock, int timeoutMs) {
    int count = group.Count;
    IntPtr[] pipeRead = new IntPtr[count];
    IntPtr[] pipeWrite = new IntPtr[count];
    SecurityAttributes sa = new SecurityAttributes();
    sa.nLength = Marshal.SizeOf(typeof(SecurityAttributes));
    sa.bInheritHandle = false;
    for (int i = 0; i < count - 1; i++) {
      IntPtr read;
      IntPtr write;
      if (!CreatePipe(out read, out write, ref sa, 0)) throw new Exception(Win("CreatePipe"));
      pipeRead[i + 1] = read;
      pipeWrite[i] = write;
    }
    ProcessInformation[] infos = new ProcessInformation[count];
    try {
      for (int i = 0; i < count; i++) {
        IntPtr stdin = i == 0 ? nul : pipeRead[i];
        IntPtr stdout = i == count - 1 ? GetStdHandle(STD_OUTPUT_HANDLE) : pipeWrite[i];
        IntPtr stderr = GetStdHandle(STD_ERROR_HANDLE);
        List<IntPtr> owned = new List<IntPtr>();
        ApplyRedirects(group[i], ref stdin, ref stdout, ref stderr, owned);
        infos[i] = SpawnSuspended(group[i].Argv, cwd, environment, stdin, stdout, stderr);
        for (int h = 0; h < owned.Count; h++) CloseHandle(owned[h]);
        if (!AssignProcessToJobObject(job, infos[i].hProcess)) {
          TerminateProcess(infos[i].hProcess, 1);
          throw new Exception(Win("AssignProcessToJobObject"));
        }
      }
      for (int i = 0; i < count; i++) {
        uint resumed = ResumeThread(infos[i].hThread);
        if (resumed == 0xFFFFFFFF) throw new Exception(Win("ResumeThread"));
      }
      for (int i = 0; i < count - 1; i++) {
        if (pipeRead[i + 1] != IntPtr.Zero) CloseHandle(pipeRead[i + 1]);
        if (pipeWrite[i] != IntPtr.Zero) CloseHandle(pipeWrite[i]);
        pipeRead[i + 1] = IntPtr.Zero;
        pipeWrite[i] = IntPtr.Zero;
      }
      int code = 0;
      for (int i = 0; i < count; i++) {
        bool exited = WaitProcess(infos[i].hProcess, clock, timeoutMs);
        uint processCode = 1;
        if (exited) GetExitCodeProcess(infos[i].hProcess, out processCode);
        code = unchecked((int)processCode);
        if (!exited) break;
      }
      return code;
    } finally {
      for (int i = 0; i < count; i++) {
        if (infos[i].hThread != IntPtr.Zero) CloseHandle(infos[i].hThread);
        if (infos[i].hProcess != IntPtr.Zero) CloseHandle(infos[i].hProcess);
        if (pipeRead[i] != IntPtr.Zero) CloseHandle(pipeRead[i]);
        if (pipeWrite[i] != IntPtr.Zero) CloseHandle(pipeWrite[i]);
      }
    }
  }

  static void ApplyRedirects(Step step, ref IntPtr stdin, ref IntPtr stdout, ref IntPtr stderr, List<IntPtr> owned) {
    for (int i = 0; i < step.Redirects.Count; i++) {
      Redirect redirect = step.Redirects[i];
      if (redirect.Kind == "merge_stderr") {
        stderr = stdout;
        continue;
      }
      IntPtr handle = OpenRedirect(redirect);
      owned.Add(handle);
      if (redirect.Kind == "stdin") stdin = handle;
      else if (redirect.Kind == "stderr" || redirect.Kind == "stderr_append") stderr = handle;
      else stdout = handle;
    }
  }

  static IntPtr OpenRedirect(Redirect redirect) {
    uint access = GENERIC_WRITE;
    uint disposition = CREATE_ALWAYS;
    if (redirect.Kind == "stdin") {
      access = GENERIC_READ;
      disposition = OPEN_EXISTING;
    } else if (redirect.Kind == "stdout_append" || redirect.Kind == "stderr_append") {
      access = FILE_APPEND_DATA;
      disposition = OPEN_ALWAYS;
    }
    IntPtr handle = CreateFile(redirect.Target, access, FILE_SHARE_READ | FILE_SHARE_WRITE, IntPtr.Zero, disposition, 0, IntPtr.Zero);
    if (handle == IntPtr.Zero || handle == new IntPtr(-1)) throw new Exception(Win("CreateFile redirect"));
    return handle;
  }

  static ProcessInformation SpawnSuspended(string[] argv, string cwd, IntPtr environment, IntPtr stdin, IntPtr stdout, IntPtr stderr) {
    SetInherit(GetStdHandle(STD_INPUT_HANDLE), false);
    SetInherit(stdin, true);
    SetInherit(stdout, true);
    SetInherit(stderr, true);
    StartupInfo startup = new StartupInfo();
    startup.cb = Marshal.SizeOf(typeof(StartupInfo));
    startup.dwFlags = STARTF_USESTDHANDLES;
    startup.hStdInput = stdin;
    startup.hStdOutput = stdout;
    startup.hStdError = stderr;
    string application = null;
    string first = argv[0];
    if (first.IndexOf('\\') >= 0 || first.IndexOf('/') >= 0 || first.IndexOf(':') >= 0) application = first;
    StringBuilder command = new StringBuilder(Quote(argv), 32768);
    ProcessInformation info;
    bool ok = CreateProcess(application, command, IntPtr.Zero, IntPtr.Zero, true, CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW, environment, cwd, ref startup, out info);
    SetInherit(stdin, false);
    SetInherit(stdout, false);
    SetInherit(stderr, false);
    if (!ok) throw new Exception(Win("CreateProcess"));
    return info;
  }

  static bool WaitProcess(IntPtr handle, Stopwatch clock, int timeoutMs) {
    while (true) {
      if (killRequested) return false;
      long remain = timeoutMs - clock.ElapsedMilliseconds;
      if (remain <= 0) {
        timedOut = true;
        return false;
      }
      uint slice = remain > 100 ? 100 : (uint)remain;
      uint waited = WaitForSingleObject(handle, slice);
      if (waited == 0) return true;
      if (waited != 0x00000102) return false;
    }
  }

  static bool TryExtended(uint flags, ulong memoryBytes, uint processLimit) {
    ExtendedLimit limit = new ExtendedLimit();
    limit.LimitFlags = flags;
    limit.ActiveProcessLimit = processLimit;
    limit.JobMemoryLimit = memoryBytes;
    IntPtr pointer = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(ExtendedLimit)));
    try {
      Marshal.StructureToPtr(limit, pointer, false);
      return SetInformationJobObject(job, JobObjectExtendedLimitInformation, pointer, Marshal.SizeOf(typeof(ExtendedLimit)));
    } finally {
      Marshal.FreeHGlobal(pointer);
    }
  }

  static void ApplyLimits(ulong memoryBytes, uint processLimit) {
    uint full = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_JOB_MEMORY | JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
    uint counted = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
    if (!TryExtended(full, memoryBytes, processLimit) && !TryExtended(counted, 0, processLimit) && !TryExtended(JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, 0, 0)) {
      throw new Exception(Win("SetInformationJobObject"));
    }
    UiRestrictions ui = new UiRestrictions();
    ui.UIRestrictionsClass = JOB_OBJECT_UILIMIT_HANDLES | JOB_OBJECT_UILIMIT_DESKTOP | JOB_OBJECT_UILIMIT_EXITWINDOWS;
    IntPtr uiPointer = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(UiRestrictions)));
    try {
      Marshal.StructureToPtr(ui, uiPointer, false);
      SetInformationJobObject(job, JobObjectBasicUIRestrictions, uiPointer, Marshal.SizeOf(typeof(UiRestrictions)));
    } finally {
      Marshal.FreeHGlobal(uiPointer);
    }
  }

  static void ReadKill() {
    try {
      string line;
      while ((line = Console.ReadLine()) != null) {
        if (line.StartsWith("KILL")) {
          lock (Gate) {
            killRequested = true;
            if (line.IndexOf("output_limit") >= 0) outputLimit = true;
          }
          KillJob();
          break;
        }
      }
    } catch (Exception) { }
  }

  static void KillJob() {
    lock (Gate) {
      if (job == IntPtr.Zero) return;
      TerminateJobObject(job, 1);
    }
  }

  static void WaitForQuiet() {
    for (int i = 0; i < 40; i++) {
      if (QueryActive() == 0) return;
      Thread.Sleep(50);
    }
  }

  static uint QueryActive() {
    if (job == IntPtr.Zero) return 0;
    IntPtr pointer = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(BasicAccounting)));
    try {
      int returned;
      if (!QueryInformationJobObject(job, JobObjectBasicAccountingInformation, pointer, Marshal.SizeOf(typeof(BasicAccounting)), out returned)) return 0;
      object raw = Marshal.PtrToStructure(pointer, typeof(BasicAccounting));
      if (raw == null) return 0;
      return ((BasicAccounting)raw).ActiveProcesses;
    } finally {
      Marshal.FreeHGlobal(pointer);
    }
  }

  static long QueryPeak() {
    if (job == IntPtr.Zero) return 0;
    IntPtr pointer = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(ExtendedLimit)));
    try {
      int returned;
      if (!QueryInformationJobObject(job, JobObjectExtendedLimitInformation, pointer, Marshal.SizeOf(typeof(ExtendedLimit)), out returned)) return 0;
      object raw = Marshal.PtrToStructure(pointer, typeof(ExtendedLimit));
      if (raw == null) return 0;
      return unchecked((long)((ExtendedLimit)raw).PeakJobMemoryUsed);
    } finally {
      Marshal.FreeHGlobal(pointer);
    }
  }

  static IntPtr AllocEnv(List<string> entries) {
    entries.Sort(StringComparer.OrdinalIgnoreCase);
    StringBuilder block = new StringBuilder();
    for (int i = 0; i < entries.Count; i++) {
      block.Append(entries[i]);
      block.Append('\0');
    }
    block.Append('\0');
    byte[] bytes = Encoding.Unicode.GetBytes(block.ToString());
    IntPtr pointer = Marshal.AllocHGlobal(bytes.Length);
    Marshal.Copy(bytes, 0, pointer, bytes.Length);
    return pointer;
  }

  static string Quote(string[] argv) {
    StringBuilder builder = new StringBuilder();
    for (int i = 0; i < argv.Length; i++) {
      if (i > 0) builder.Append(' ');
      builder.Append(QuoteArg(argv[i]));
    }
    return builder.ToString();
  }

  static string QuoteArg(string arg) {
    if (arg.Length == 0) return "\"\"";
    if (arg.IndexOf(' ') < 0 && arg.IndexOf('\t') < 0 && arg.IndexOf('"') < 0) return arg;
    StringBuilder builder = new StringBuilder();
    builder.Append('"');
    int slashes = 0;
    for (int i = 0; i < arg.Length; i++) {
      char ch = arg[i];
      if (ch == '\\') { slashes++; continue; }
      if (ch == '"') {
        builder.Append('\\', slashes * 2 + 1);
        builder.Append('"');
        slashes = 0;
        continue;
      }
      if (slashes > 0) { builder.Append('\\', slashes); slashes = 0; }
      builder.Append(ch);
    }
    if (slashes > 0) builder.Append('\\', slashes * 2);
    builder.Append('"');
    return builder.ToString();
  }

  static void SetInherit(IntPtr handle, bool inherit) {
    if (handle == IntPtr.Zero || handle == new IntPtr(-1)) return;
    SetHandleInformation(handle, 1, inherit ? (uint)1 : (uint)0);
  }

  static void WriteResult(string resultPath) {
    if (resultPath.Length == 0) return;
    string reason = "completed";
    if (outputLimit) reason = "output_limit_exceeded";
    else if (timedOut) reason = "timeout";
    else if (oomKilled) reason = "memory_limit_exceeded";
    StringBuilder builder = new StringBuilder();
    builder.Append("exitCode=").Append(exitCode).Append('\n');
    builder.Append("timedOut=").Append(timedOut ? "true" : "false").Append('\n');
    builder.Append("oomKilled=").Append(oomKilled ? "true" : "false").Append('\n');
    builder.Append("peakMemoryBytes=").Append(peakMemory).Append('\n');
    builder.Append("outputLimitExceeded=").Append(outputLimit ? "true" : "false").Append('\n');
    builder.Append("terminationReason=").Append(reason).Append('\n');
    builder.Append("error=").Append(error.Replace('\n', ' ').Replace('\r', ' ')).Append('\n');
    File.WriteAllText(resultPath, builder.ToString(), new UTF8Encoding(false));
  }

  static string Arg(string[] args, string name) {
    for (int i = 0; i < args.Length - 1; i++) {
      if (args[i] == name) return args[i + 1];
    }
    return "";
  }

  static string Win(string what) {
    return what + " failed (win32 " + Marshal.GetLastWin32Error() + ")";
  }

  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool SetInformationJobObject(IntPtr hJob, int jobObjectInformationClass, IntPtr lpJobObjectInformation, int cbJobObjectInformationLength);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool QueryInformationJobObject(IntPtr hJob, int jobObjectInformationClass, IntPtr lpJobObjectInformation, int cbJobObjectInformationLength, out int lpReturnLength);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool TerminateJobObject(IntPtr hJob, uint uExitCode);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool CloseHandle(IntPtr hObject);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool SetHandleInformation(IntPtr hObject, uint dwMask, uint dwFlags);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool CreatePipe(out IntPtr hReadPipe, out IntPtr hWritePipe, ref SecurityAttributes lpPipeAttributes, int nSize);

  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool CreateProcess(string lpApplicationName, StringBuilder lpCommandLine, IntPtr lpProcessAttributes, IntPtr lpThreadAttributes, bool bInheritHandles, uint dwCreationFlags, IntPtr lpEnvironment, string lpCurrentDirectory, ref StartupInfo lpStartupInfo, out ProcessInformation lpProcessInformation);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern uint ResumeThread(IntPtr hThread);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool GetExitCodeProcess(IntPtr hProcess, out uint lpExitCode);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool TerminateProcess(IntPtr hProcess, uint uExitCode);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern IntPtr GetStdHandle(int nStdHandle);

  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern IntPtr CreateFile(string lpFileName, uint dwDesiredAccess, uint dwShareMode, IntPtr lpSecurityAttributes, uint dwCreationDisposition, uint dwFlagsAndAttributes, IntPtr hTemplateFile);
}
