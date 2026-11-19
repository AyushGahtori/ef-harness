using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

internal static class Win32JobHelper
{
    const uint PROCESS_TERMINATE = 0x0001;
    const uint PROCESS_SET_QUOTA = 0x0100;
    const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    const uint SYNCHRONIZE = 0x00100000;
    const uint CREATE_SUSPENDED = 0x00000004;
    const uint CREATE_NO_WINDOW = 0x08000000;
    const uint DETACHED_PROCESS = 0x00000008;
    const uint STARTF_USESTDHANDLES = 0x00000100;
    const uint HANDLE_FLAG_INHERIT = 0x00000001;
    const uint JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 0x00000008;
    const uint JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x00000100;
    const uint JOB_OBJECT_LIMIT_JOB_MEMORY = 0x00000200;
    const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
    const uint JOB_OBJECT_CPU_RATE_CONTROL_ENABLE = 0x1;
    const uint JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP = 0x4;
    const uint JOB_OBJECT_UILIMIT_HANDLES = 0x00000001;
    const uint UI_RESTRICTIONS = 0x000000FF;
    const int ErrorMoreData = 234;
    const uint STILL_ACTIVE = 259;
    const int JobObjectBasicAccountingInformation = 1;
    const int JobObjectBasicProcessIdList = 3;
    const int JobObjectBasicUIRestrictions = 4;
    const int JobObjectAssociateCompletionPortInformation = 7;
    const int JobObjectExtendedLimitInformation = 9;
    const int JobObjectCpuRateControlInformation = 15;
    const int JobObjectMemoryUsageInformation = 28;
    const int ProcessCommandLineInformation = 60;
    const int OutputCap = 128 * 1024;

    static readonly object Gate = new object();
    static readonly Dictionary<int, JobRec> Jobs = new Dictionary<int, JobRec>();
    static readonly Dictionary<int, ProcRec> Procs = new Dictionary<int, ProcRec>();
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    static IntPtr CompletionPort = IntPtr.Zero;
    static volatile bool Running = true;
    static int NextJobId = 1;
    static int NextSlot = 1;
    static int ShutdownFlag;

    static int Main(string[] args)
    {
        Console.InputEncoding = Encoding.UTF8;
        Console.OutputEncoding = Encoding.UTF8;
        int parentPid = 0;
        if (args.Length > 0) int.TryParse(args[0], out parentPid);
        int extended = Marshal.SizeOf(typeof(ExtendedLimit));
        if (IntPtr.Size != 8 || extended != 144) FailStartup("ExtendedLimit layout is " + extended + " on pointer size " + IntPtr.Size);
        CompletionPort = CreateIoCompletionPort(new IntPtr(-1), IntPtr.Zero, UIntPtr.Zero, 1);
        if (CompletionPort == IntPtr.Zero) FailStartup("CreateIoCompletionPort failed: " + Marshal.GetLastWin32Error());
        if (parentPid > 0)
        {
            Thread parentWatch = new Thread(() => WatchParent(parentPid));
            parentWatch.IsBackground = true;
            parentWatch.Start();
        }
        string line;
        while ((line = Console.ReadLine()) != null)
        {
            if (line.Trim().Length == 0) continue;
            Dispatch(line);
        }
        Shutdown();
        return 0;
    }

    static void FailStartup(string message)
    {
        Console.Error.WriteLine(message);
        Environment.Exit(1);
    }

    static void WatchParent(int parentPid)
    {
        IntPtr parent = OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, false, (uint)parentPid);
        if (parent == IntPtr.Zero) return;
        WaitForSingleObject(parent, 0xFFFFFFFF);
        CloseHandle(parent);
        Shutdown();
        Environment.Exit(0);
    }

    static void DrainNotifications()
    {
        if (CompletionPort == IntPtr.Zero) return;
        while (true)
        {
            uint message;
            UIntPtr key;
            IntPtr overlapped;
            bool got = GetQueuedCompletionStatus(CompletionPort, out message, out key, out overlapped, 0);
            if (!got) return;
            int jobId;
            try { jobId = checked((int)key.ToUInt64()); }
            catch (OverflowException) { continue; }
            JobRec job;
            if (!Jobs.TryGetValue(jobId, out job)) continue;
            if (message == 9 || message == 10) job.MemoryLimitHit = true;
            if (message == 3) job.ActiveProcessLimitHit = true;
        }
    }

    static void Shutdown()
    {
        if (Interlocked.Exchange(ref ShutdownFlag, 1) != 0) return;
        Running = false;
        lock (Gate)
        {
            foreach (JobRec job in Jobs.Values)
            {
                TerminateJobObject(job.Handle, 1);
                CloseHandle(job.Handle);
            }
            Jobs.Clear();
            foreach (ProcRec proc in Procs.Values) proc.Dispose();
            Procs.Clear();
            if (CompletionPort != IntPtr.Zero)
            {
                CloseHandle(CompletionPort);
                CompletionPort = IntPtr.Zero;
            }
        }
    }

    static void Dispatch(string line)
    {
        int id = 0;
        try
        {
            Dictionary<string, object> msg = Json.Deserialize<Dictionary<string, object>>(line);
            id = AsInt(Require(msg, "id"));
            string op = AsString(Require(msg, "op"));
            lock (Gate)
            {
                if (op == "ping") { WriteLine(Ok(id).End()); return; }
                if (op == "shutdown") { WriteLine(Ok(id).End()); Shutdown(); Environment.Exit(0); return; }
                if (op == "handleCount") { WriteLine(Ok(id).Prop("handles", HandleCount()).End()); return; }
                if (op == "createJob") { CreateJob(id, msg); return; }
                if (op == "spawn") { Spawn(id, msg); return; }
                if (op == "resume") { Resume(id, msg); return; }
                if (op == "assignPid") { AssignPid(id, msg); return; }
                if (op == "query") { Query(id, msg); return; }
                if (op == "terminateJob") { Terminate(id, msg); return; }
                if (op == "closeJob") { CloseJob(id, msg); return; }
                if (op == "inspect") { Inspect(id, msg, false, 0); return; }
                if (op == "confirmTerminate") { Inspect(id, msg, true, AsLong(Require(msg, "startTime"))); return; }
                if (op == "waitExit") { WaitExit(id, msg); return; }
                if (op == "readOutput") { ReadOutput(id, msg); return; }
                if (op == "listProcesses") { ListProcesses(id, msg); return; }
                WriteLine(Error(id, "unknown op " + op, 0));
            }
        }
        catch (Exception ex)
        {
            WriteLine(Error(id, ex.Message, Marshal.GetLastWin32Error()));
        }
    }

    static void CreateJob(int id, Dictionary<string, object> msg)
    {
        long memory = AsLong(Require(msg, "memoryBytes"));
        int active = AsInt(Require(msg, "activeProcessLimit"));
        int cpu = AsInt(Require(msg, "cpuRatePercent"));
        int parentId = AsInt(Require(msg, "parentJobId"));
        if (memory < 1 || active < 1) { WriteLine(Error(id, "limits must be positive", 0)); return; }
        IntPtr handle = CreateJobObject(IntPtr.Zero, null);
        if (handle == IntPtr.Zero) { WriteLine(Error(id, "CreateJobObject failed", Marshal.GetLastWin32Error())); return; }
        if (parentId != 0)
        {
            JobRec parent;
            if (!Jobs.TryGetValue(parentId, out parent))
            {
                CloseHandle(handle);
                WriteLine(Error(id, "parent job is not open", 0));
                return;
            }
            string nestError = NestUnder(parent, handle);
            if (nestError != null)
            {
                CloseHandle(handle);
                WriteLine(Error(id, nestError, Marshal.GetLastWin32Error()));
                return;
            }
        }
        string limitError = ApplyLimits(handle, memory, active, cpu, parentId != 0);
        if (limitError != null)
        {
            CloseHandle(handle);
            WriteLine(Error(id, parentId == 0 ? limitError : "nested limit rejected: " + limitError, Marshal.GetLastWin32Error()));
            return;
        }
        int jobId = NextJobId++;
        if (!AssociatePort(handle, jobId))
        {
            int err = Marshal.GetLastWin32Error();
            CloseHandle(handle);
            WriteLine(Error(id, "AssociateCompletionPort failed", err));
            return;
        }
        LimitSnapshot snap = ReadLimits(handle);
        Jobs[jobId] = new JobRec(handle, parentId, memory, active, cpu);
        long ui = EffectiveUi(parentId, snap.UiRestrictions);
        WriteLine(Ok(id)
            .Prop("jobId", jobId)
            .Prop("memoryBytes", snap.MemoryBytes)
            .Prop("processMemoryBytes", snap.ProcessMemoryBytes)
            .Prop("activeProcessLimit", snap.ActiveProcessLimit)
            .Prop("cpuRatePercent", snap.CpuRatePercent)
            .Prop("limitFlags", snap.LimitFlags)
            .Prop("uiRestrictions", ui)
            .Prop("killOnJobClose", snap.KillOnJobClose)
            .Prop("uiHandlesRestricted", (ui & JOB_OBJECT_UILIMIT_HANDLES) != 0)
            .End());
    }

    static string NestUnder(JobRec parent, IntPtr child)
    {
        // UI limits cannot be cleared once set (ERROR_NOT_SUPPORTED), and a nested
        // job cannot record its own UI class when an ancestor already has one.
        // Assign outermost-first so the new job is nested. Processes placed in the
        // child remain members of every ancestor, so the ancestor's
        // JOB_OBJECT_UILIMIT_HANDLES and KILL_ON_JOB_CLOSE still apply.
        List<JobRec> chain = AncestorChain(parent);
        string cmd = Environment.SystemDirectory + "\\cmd.exe";
        ProcHandles boot;
        string error = CreateSuspended(cmd, "\"" + cmd + "\" /d /c exit", null, false, out boot);
        if (error != null) return error;
        string nestError = null;
        try
        {
            foreach (JobRec job in chain)
            {
                if (AssignProcessToJobObject(job.Handle, boot.Process)) continue;
                nestError = "assign bootstrap to ancestor failed: " + Marshal.GetLastWin32Error();
                break;
            }
            if (nestError == null && !AssignProcessToJobObject(child, boot.Process))
                nestError = "assign bootstrap to child failed: " + Marshal.GetLastWin32Error();
        }
        finally
        {
            TerminateProcess(boot.Process, 1);
            WaitForSingleObject(boot.Process, 2000);
            boot.Dispose();
        }
        return nestError;
    }

    static List<JobRec> AncestorChain(JobRec job)
    {
        List<JobRec> chain = new List<JobRec>();
        JobRec current = job;
        while (current != null)
        {
            chain.Add(current);
            JobRec next;
            if (current.ParentId == 0 || !Jobs.TryGetValue(current.ParentId, out next)) break;
            current = next;
        }
        chain.Reverse();
        return chain;
    }

    static string ApplyLimits(IntPtr job, long memory, int active, int cpu, bool nested)
    {
        ExtendedLimit info = new ExtendedLimit();
        info.Basic.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            | JOB_OBJECT_LIMIT_JOB_MEMORY
            | JOB_OBJECT_LIMIT_PROCESS_MEMORY
            | JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
        info.Basic.ActiveProcessLimit = (uint)active;
        info.JobMemoryLimit = new UIntPtr((ulong)memory);
        info.ProcessMemoryLimit = new UIntPtr((ulong)memory);
        int size = Marshal.SizeOf(typeof(ExtendedLimit));
        IntPtr ptr = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(info, ptr, false);
            if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, ptr, (uint)size))
                return "SetInformationJobObject limits failed: " + Marshal.GetLastWin32Error();
        }
        finally { Marshal.FreeHGlobal(ptr); }
        string uiError = SetUiLimits(job, UI_RESTRICTIONS);
        if (uiError != null)
        {
            // Nested jobs return ERROR_NOT_SUPPORTED (50) once an ancestor owns the
            // UI class. Membership in that ancestor still enforces the restriction.
            if (!(nested && uiError.EndsWith(": 50"))) return uiError;
        }
        if (cpu > 0)
        {
            CpuRate rate = new CpuRate();
            rate.ControlFlags = JOB_OBJECT_CPU_RATE_CONTROL_ENABLE | JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP;
            rate.CpuRateValue = (uint)(cpu * 100);
            if (!SetStruct(job, JobObjectCpuRateControlInformation, rate))
                return "SetInformationJobObject CPU rate failed: " + Marshal.GetLastWin32Error();
        }
        return null;
    }

    static long EffectiveUi(int parentId, long own)
    {
        long mask = own;
        int current = parentId;
        while (current != 0)
        {
            JobRec job;
            if (!Jobs.TryGetValue(current, out job)) break;
            LimitSnapshot snap = ReadLimits(job.Handle);
            mask |= snap.UiRestrictions;
            current = job.ParentId;
        }
        return mask;
    }

    static string SetUiLimits(IntPtr job, uint mask)
    {
        UiLimit ui = new UiLimit();
        ui.UIRestrictionsClass = mask;
        if (!SetStruct(job, JobObjectBasicUIRestrictions, ui))
            return "SetInformationJobObject UI restrictions failed: " + Marshal.GetLastWin32Error();
        return null;
    }

    static bool AssociatePort(IntPtr job, int jobId)
    {
        CompletionAssociation assoc = new CompletionAssociation();
        assoc.CompletionKey = new IntPtr(jobId);
        assoc.CompletionPort = CompletionPort;
        return SetStruct(job, JobObjectAssociateCompletionPortInformation, assoc);
    }

    static void Spawn(int id, Dictionary<string, object> msg)
    {
        int jobId = AsInt(Require(msg, "jobId"));
        JobRec job;
        if (!Jobs.TryGetValue(jobId, out job)) { WriteLine(Error(id, "job is not open", 0)); return; }
        string application = AsString(Require(msg, "application"));
        string commandLine = AsString(Require(msg, "commandLine"));
        string cwd = OptionalString(msg, "cwd");
        bool capture = AsBool(Require(msg, "capture"));
        bool resume = AsBool(Require(msg, "resume"));
        ProcHandles handles;
        string error = CreateSuspended(application, commandLine, cwd, capture, out handles);
        if (error != null) { WriteLine(Error(id, error, Marshal.GetLastWin32Error())); return; }
        if (!AssignProcessToJobObject(job.Handle, handles.Process))
        {
            int win32 = Marshal.GetLastWin32Error();
            TerminateProcess(handles.Process, 1);
            handles.Dispose();
            WriteLine(Error(id, "AssignProcessToJobObject failed", win32));
            return;
        }
        Identity identity = ReadIdentity(handles.Process);
        int slot = NextSlot++;
        ProcRec rec = new ProcRec(slot, jobId, handles, identity.Pid);
        if (capture) rec.StartPumps();
        Procs[slot] = rec;
        if (resume && ResumeThread(handles.Thread) == 0xFFFFFFFF)
        {
            int win32 = Marshal.GetLastWin32Error();
            TerminateProcess(handles.Process, 1);
            Procs.Remove(slot);
            rec.Dispose();
            WriteLine(Error(id, "ResumeThread failed", win32));
            return;
        }
        WriteLine(Ok(id)
            .Prop("slot", slot)
            .Prop("pid", identity.Pid)
            .Prop("startTime", identity.StartTime)
            .Prop("imagePath", identity.ImagePath)
            .Prop("commandLine", identity.CommandLine)
            .End());
    }

    static void Resume(int id, Dictionary<string, object> msg)
    {
        ProcRec proc = RequireProc(id, AsInt(Require(msg, "slot")));
        if (proc == null) return;
        uint resumed = ResumeThread(proc.Handles.Thread);
        if (resumed == 0xFFFFFFFF) { WriteLine(Error(id, "ResumeThread failed", Marshal.GetLastWin32Error())); return; }
        WriteLine(Ok(id).End());
    }

    static void AssignPid(int id, Dictionary<string, object> msg)
    {
        JobRec job;
        if (!Jobs.TryGetValue(AsInt(Require(msg, "jobId")), out job))
        {
            WriteLine(Error(id, "job is not open", 0));
            return;
        }
        uint pid = (uint)AsLong(Require(msg, "pid"));
        IntPtr process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
        if (process == IntPtr.Zero) { WriteLine(Error(id, "OpenProcess failed", Marshal.GetLastWin32Error())); return; }
        try
        {
            if (!AssignProcessToJobObject(job.Handle, process))
            {
                WriteLine(Error(id, "AssignProcessToJobObject failed", Marshal.GetLastWin32Error()));
                return;
            }
            Identity identity = ReadIdentity(process);
            WriteLine(Ok(id)
                .Prop("pid", identity.Pid)
                .Prop("startTime", identity.StartTime)
                .Prop("imagePath", identity.ImagePath)
                .Prop("commandLine", identity.CommandLine)
                .End());
        }
        finally { CloseHandle(process); }
    }

    static void Query(int id, Dictionary<string, object> msg)
    {
        DrainNotifications();
        JobRec job = RequireJob(id, AsInt(Require(msg, "jobId")));
        if (job == null) return;
        Accounting acc = ReadAccounting(job.Handle);
        LimitSnapshot snap = ReadLimits(job.Handle);
        MemoryUsage mem = ReadMemory(job.Handle);
        long ui = EffectiveUi(job.ParentId, snap.UiRestrictions);
        WriteLine(Ok(id)
            .Prop("activeProcesses", acc.ActiveProcesses)
            .Prop("totalProcesses", acc.TotalProcesses)
            .Prop("totalTerminatedProcesses", acc.TotalTerminatedProcesses)
            .Prop("totalPageFaults", acc.TotalPageFaults)
            .Prop("userCpuMs", acc.UserCpuMs)
            .Prop("kernelCpuMs", acc.KernelCpuMs)
            .Prop("peakJobMemoryBytes", mem.Peak > 0 ? mem.Peak : snap.PeakJobMemory)
            .Prop("currentJobMemoryBytes", mem.Current)
            .Prop("peakProcessMemoryBytes", snap.PeakProcessMemory)
            .Prop("jobMemoryLimitBytes", snap.MemoryBytes)
            .Prop("processMemoryLimitBytes", snap.ProcessMemoryBytes)
            .Prop("activeProcessLimit", snap.ActiveProcessLimit)
            .Prop("limitFlags", snap.LimitFlags)
            .Prop("uiRestrictions", ui)
            .Prop("cpuRatePercent", snap.CpuRatePercent)
            .Prop("killOnJobClose", snap.KillOnJobClose)
            .Prop("uiHandlesRestricted", (ui & JOB_OBJECT_UILIMIT_HANDLES) != 0)
            .Prop("memoryLimitHit", job.MemoryLimitHit || mem.Peak >= snap.MemoryBytes && snap.MemoryBytes > 0)
            .Prop("activeProcessLimitHit", job.ActiveProcessLimitHit)
            .End());
    }

    static void Terminate(int id, Dictionary<string, object> msg)
    {
        JobRec job = RequireJob(id, AsInt(Require(msg, "jobId")));
        if (job == null) return;
        if (!TerminateJobObject(job.Handle, 1))
        {
            WriteLine(Error(id, "TerminateJobObject failed", Marshal.GetLastWin32Error()));
            return;
        }
        WriteLine(Ok(id).End());
    }

    static void CloseJob(int id, Dictionary<string, object> msg)
    {
        int jobId = AsInt(Require(msg, "jobId"));
        JobRec job;
        if (!Jobs.TryGetValue(jobId, out job)) { WriteLine(Ok(id).Prop("closed", true).End()); return; }
        TerminateJobObject(job.Handle, 1);
        CloseHandle(job.Handle);
        Jobs.Remove(jobId);
        List<int> slots = new List<int>();
        foreach (KeyValuePair<int, ProcRec> pair in Procs)
        {
            if (pair.Value.JobId == jobId) slots.Add(pair.Key);
        }
        foreach (int slot in slots)
        {
            Procs[slot].Dispose();
            Procs.Remove(slot);
        }
        WriteLine(Ok(id).Prop("closed", true).End());
    }

    static void Inspect(int id, Dictionary<string, object> msg, bool terminate, long expectedStart)
    {
        uint pid = (uint)AsLong(Require(msg, "pid"));
        uint access = PROCESS_QUERY_LIMITED_INFORMATION | (terminate ? PROCESS_TERMINATE : 0);
        IntPtr process = OpenProcess(access, false, pid);
        if (process == IntPtr.Zero)
        {
            int err = Marshal.GetLastWin32Error();
            string action = err == 5 ? "unverified" : "not_found";
            WriteLine(Ok(id).Prop("action", action).Prop("detail", "OpenProcess " + err).Prop("startTime", 0).End());
            return;
        }
        try
        {
            uint exitCode;
            if (!GetExitCodeProcess(process, out exitCode))
            {
                WriteLine(Ok(id).Prop("action", "unverified").Prop("detail", "GetExitCodeProcess " + Marshal.GetLastWin32Error()).Prop("startTime", 0).End());
                return;
            }
            if (exitCode != STILL_ACTIVE)
            {
                WriteLine(Ok(id).Prop("action", terminate ? "already_exited" : "not_found").Prop("detail", "exit " + exitCode).Prop("startTime", 0).End());
                return;
            }
            Identity identity;
            try { identity = ReadIdentity(process); }
            catch (Exception ex)
            {
                WriteLine(Ok(id).Prop("action", "unverified").Prop("detail", ex.Message).Prop("startTime", 0).End());
                return;
            }
            if (terminate && identity.StartTime != expectedStart)
            {
                WriteLine(Ok(id)
                    .Prop("action", "mismatch")
                    .Prop("startTime", identity.StartTime)
                    .Prop("imagePath", identity.ImagePath)
                    .Prop("commandLine", identity.CommandLine)
                    .Prop("detail", "start_time mismatch")
                    .End());
                return;
            }
            if (terminate)
            {
                if (!TerminateProcess(process, 1))
                {
                    WriteLine(Ok(id).Prop("action", "unverified").Prop("detail", "TerminateProcess " + Marshal.GetLastWin32Error()).Prop("startTime", identity.StartTime).End());
                    return;
                }
                WriteLine(Ok(id).Prop("action", "terminated").Prop("startTime", identity.StartTime).Prop("imagePath", identity.ImagePath).Prop("commandLine", identity.CommandLine).End());
                return;
            }
            WriteLine(Ok(id)
                .Prop("action", "alive")
                .Prop("startTime", identity.StartTime)
                .Prop("imagePath", identity.ImagePath)
                .Prop("commandLine", identity.CommandLine)
                .End());
        }
        finally { CloseHandle(process); }
    }

    static void WaitExit(int id, Dictionary<string, object> msg)
    {
        ProcRec proc = RequireProc(id, AsInt(Require(msg, "slot")));
        if (proc == null) return;
        int timeout = AsInt(Require(msg, "timeoutMs"));
        uint waited = WaitForSingleObject(proc.Handles.Process, (uint)Math.Max(0, timeout));
        uint exitCode;
        GetExitCodeProcess(proc.Handles.Process, out exitCode);
        bool exited = exitCode != STILL_ACTIVE;
        JsonBuilder builder = Ok(id).Prop("exited", exited).Prop("wait", waited);
        if (exited) builder.Prop("exitCode", exitCode);
        else builder.Prop("exitCode", -1);
        WriteLine(builder.End());
    }

    static void ReadOutput(int id, Dictionary<string, object> msg)
    {
        ProcRec proc = RequireProc(id, AsInt(Require(msg, "slot")));
        if (proc == null) return;
        string stdout;
        string stderr;
        bool stdoutTruncated;
        bool stderrTruncated;
        proc.CopyOutput(out stdout, out stderr, out stdoutTruncated, out stderrTruncated);
        WriteLine(Ok(id)
            .Prop("stdout", stdout)
            .Prop("stderr", stderr)
            .Prop("stdoutTruncated", stdoutTruncated)
            .Prop("stderrTruncated", stderrTruncated)
            .End());
    }

    static void ListProcesses(int id, Dictionary<string, object> msg)
    {
        JobRec job = RequireJob(id, AsInt(Require(msg, "jobId")));
        if (job == null) return;
        const int header = 8;
        int capacity = 32;
        for (int attempt = 0; attempt < 6; attempt++)
        {
            int bytes = header + (8 * capacity);
            IntPtr ptr = Marshal.AllocHGlobal(bytes);
            try
            {
                Marshal.WriteInt32(ptr, 0, 0);
                Marshal.WriteInt32(ptr, 4, capacity);
                uint returned;
                if (!QueryInformationJobObject(job.Handle, JobObjectBasicProcessIdList, ptr, (uint)bytes, out returned))
                {
                    int err = Marshal.GetLastWin32Error();
                    int needed = Marshal.ReadInt32(ptr, 0);
                    if (err == ErrorMoreData && needed > capacity)
                    {
                        capacity = needed;
                        continue;
                    }
                    WriteLine(Error(id, "process id list failed", err));
                    return;
                }
                int assigned = Marshal.ReadInt32(ptr, 0);
                int listed = Marshal.ReadInt32(ptr, 4);
                int count = Math.Min(assigned, listed);
                StringBuilder array = new StringBuilder();
                array.Append('[');
                for (int i = 0; i < count; i++)
                {
                    long pid = Marshal.ReadInt64(ptr, header + (i * 8));
                    if (pid <= 0) continue;
                    if (array.Length > 1) array.Append(',');
                    string image = ImagePath((uint)pid);
                    array.Append("{\"pid\":").Append(pid.ToString(CultureInfo.InvariantCulture));
                    array.Append(",\"imagePath\":").Append(Js(image)).Append('}');
                }
                array.Append(']');
                WriteLine(Ok(id).Raw("processes", array.ToString()).End());
                return;
            }
            finally { Marshal.FreeHGlobal(ptr); }
        }
        WriteLine(Error(id, "process id list failed", ErrorMoreData));
    }

    static string CreateSuspended(string application, string commandLine, string cwd, bool capture, out ProcHandles handles)
    {
        handles = null;
        IntPtr stdin = IntPtr.Zero;
        IntPtr stdoutRead = IntPtr.Zero;
        IntPtr stdoutWrite = IntPtr.Zero;
        IntPtr stderrRead = IntPtr.Zero;
        IntPtr stderrWrite = IntPtr.Zero;
        try
        {
            SecurityAttributes sa = new SecurityAttributes();
            sa.nLength = Marshal.SizeOf(typeof(SecurityAttributes));
            sa.bInheritHandle = true;
            stdin = CreateFileW("NUL", 0x80000000, 1, ref sa, 3, 0, IntPtr.Zero);
            if (stdin == IntPtr.Zero || stdin == new IntPtr(-1)) return "open NUL failed";
            if (capture)
            {
                if (!CreatePipe(out stdoutRead, out stdoutWrite, ref sa, 0)) return "stdout pipe failed";
                if (!CreatePipe(out stderrRead, out stderrWrite, ref sa, 0)) return "stderr pipe failed";
                SetHandleInformation(stdoutRead, HANDLE_FLAG_INHERIT, 0);
                SetHandleInformation(stderrRead, HANDLE_FLAG_INHERIT, 0);
            }
            StartupInfo startup = new StartupInfo();
            startup.cb = Marshal.SizeOf(typeof(StartupInfo));
            startup.dwFlags = (int)STARTF_USESTDHANDLES;
            startup.hStdInput = stdin;
            startup.hStdOutput = capture ? stdoutWrite : stdin;
            startup.hStdError = capture ? stderrWrite : stdin;
            ProcessInformation info;
            StringBuilder mutable = new StringBuilder(commandLine, Math.Max(commandLine.Length + 16, 32768));
            uint flags = CREATE_SUSPENDED | CREATE_NO_WINDOW | DETACHED_PROCESS;
            string directory = string.IsNullOrEmpty(cwd) ? null : cwd;
            bool created = CreateProcessW(application, mutable, IntPtr.Zero, IntPtr.Zero, true, flags, IntPtr.Zero, directory, ref startup, out info);
            int err = Marshal.GetLastWin32Error();
            if (!created)
            {
                return "CreateProcessW failed: " + err;
            }
            handles = new ProcHandles(info.hProcess, info.hThread, info.dwProcessId, stdoutRead, stderrRead);
            stdoutRead = IntPtr.Zero;
            stderrRead = IntPtr.Zero;
            return null;
        }
        finally
        {
            if (stdoutWrite != IntPtr.Zero) CloseHandle(stdoutWrite);
            if (stderrWrite != IntPtr.Zero) CloseHandle(stderrWrite);
            if (stdin != IntPtr.Zero && stdin != new IntPtr(-1)) CloseHandle(stdin);
            if (handles == null)
            {
                if (stdoutRead != IntPtr.Zero) CloseHandle(stdoutRead);
                if (stderrRead != IntPtr.Zero) CloseHandle(stderrRead);
            }
        }
    }

    static Identity ReadIdentity(IntPtr process)
    {
        long creation, exit, kernel, user;
        if (!GetProcessTimes(process, out creation, out exit, out kernel, out user))
            throw new InvalidOperationException("GetProcessTimes failed: " + Marshal.GetLastWin32Error());
        long start = (creation / 10000L) - 11644473600000L;
        uint pid = GetProcessId(process);
        return new Identity(pid, start, ImagePath(pid), CommandLine(process));
    }

    static string ImagePath(uint pid)
    {
        IntPtr process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
        if (process == IntPtr.Zero) return null;
        try
        {
            StringBuilder name = new StringBuilder(1024);
            uint size = 1024;
            if (!QueryFullProcessImageNameW(process, 0, name, ref size)) return null;
            return name.ToString();
        }
        finally { CloseHandle(process); }
    }

    static string CommandLine(IntPtr process)
    {
        int needed;
        int status = NtQueryInformationProcess(process, ProcessCommandLineInformation, IntPtr.Zero, 0, out needed);
        if (needed <= 0 || needed > 1 << 20) return null;
        IntPtr buffer = Marshal.AllocHGlobal(needed);
        try
        {
            status = NtQueryInformationProcess(process, ProcessCommandLineInformation, buffer, needed, out needed);
            if (status != 0) return null;
            short length = Marshal.ReadInt16(buffer, 0);
            if (length <= 0) return "";
            IntPtr chars = Marshal.ReadIntPtr(buffer, IntPtr.Size);
            return Marshal.PtrToStringUni(chars, length / 2);
        }
        catch (AccessViolationException) { return null; }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    static Accounting ReadAccounting(IntPtr job)
    {
        IntPtr ptr = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(BasicAccounting)));
        try
        {
            uint returned;
            if (!QueryInformationJobObject(job, JobObjectBasicAccountingInformation, ptr, (uint)Marshal.SizeOf(typeof(BasicAccounting)), out returned))
                throw new InvalidOperationException("accounting query failed: " + Marshal.GetLastWin32Error());
            BasicAccounting info = (BasicAccounting)Marshal.PtrToStructure(ptr, typeof(BasicAccounting));
            return new Accounting(
                info.TotalUserTime / 10000L,
                info.TotalKernelTime / 10000L,
                info.TotalPageFaultCount,
                info.TotalProcesses,
                info.ActiveProcesses,
                info.TotalTerminatedProcesses);
        }
        finally { Marshal.FreeHGlobal(ptr); }
    }

    static MemoryUsage ReadMemory(IntPtr job)
    {
        IntPtr ptr = Marshal.AllocHGlobal(16);
        try
        {
            uint returned;
            if (!QueryInformationJobObject(job, JobObjectMemoryUsageInformation, ptr, 16, out returned))
                return new MemoryUsage(0, 0);
            return new MemoryUsage((long)Marshal.ReadInt64(ptr, 0), (long)Marshal.ReadInt64(ptr, 8));
        }
        finally { Marshal.FreeHGlobal(ptr); }
    }

    static LimitSnapshot ReadLimits(IntPtr job)
    {
        int size = Marshal.SizeOf(typeof(ExtendedLimit));
        IntPtr ptr = Marshal.AllocHGlobal(size);
        try
        {
            uint returned;
            if (!QueryInformationJobObject(job, JobObjectExtendedLimitInformation, ptr, (uint)size, out returned))
                throw new InvalidOperationException("limit query failed: " + Marshal.GetLastWin32Error());
            ExtendedLimit info = (ExtendedLimit)Marshal.PtrToStructure(ptr, typeof(ExtendedLimit));
            uint ui = 0;
            IntPtr uiPtr = Marshal.AllocHGlobal(4);
            try
            {
                if (QueryInformationJobObject(job, JobObjectBasicUIRestrictions, uiPtr, 4, out returned))
                    ui = (uint)Marshal.ReadInt32(uiPtr);
            }
            finally { Marshal.FreeHGlobal(uiPtr); }
            int cpu = 0;
            IntPtr cpuPtr = Marshal.AllocHGlobal(8);
            try
            {
                if (QueryInformationJobObject(job, JobObjectCpuRateControlInformation, cpuPtr, 8, out returned))
                {
                    uint flags = (uint)Marshal.ReadInt32(cpuPtr);
                    uint rate = (uint)Marshal.ReadInt32(cpuPtr, 4);
                    if ((flags & JOB_OBJECT_CPU_RATE_CONTROL_ENABLE) != 0) cpu = (int)(rate / 100);
                }
            }
            finally { Marshal.FreeHGlobal(cpuPtr); }
            return new LimitSnapshot(
                (long)info.JobMemoryLimit.ToUInt64(),
                (long)info.ProcessMemoryLimit.ToUInt64(),
                (long)info.PeakJobMemoryUsed.ToUInt64(),
                (long)info.PeakProcessMemoryUsed.ToUInt64(),
                (int)info.Basic.ActiveProcessLimit,
                (long)info.Basic.LimitFlags,
                (long)ui,
                cpu,
                (info.Basic.LimitFlags & JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE) != 0,
                (ui & JOB_OBJECT_UILIMIT_HANDLES) != 0);
        }
        finally { Marshal.FreeHGlobal(ptr); }
    }

    static long HandleCount()
    {
        uint count;
        if (!GetProcessHandleCount(GetCurrentProcess(), out count)) return -1;
        return count;
    }

    static JobRec RequireJob(int id, int jobId)
    {
        JobRec job;
        if (!Jobs.TryGetValue(jobId, out job))
        {
            WriteLine(Error(id, "job is not open", 0));
            return null;
        }
        return job;
    }

    static ProcRec RequireProc(int id, int slot)
    {
        ProcRec proc;
        if (!Procs.TryGetValue(slot, out proc))
        {
            WriteLine(Error(id, "process slot is not open", 0));
            return null;
        }
        return proc;
    }

    static bool SetStruct(IntPtr job, int cls, object value)
    {
        int size = Marshal.SizeOf(value);
        IntPtr ptr = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(value, ptr, false);
            return SetInformationJobObject(job, cls, ptr, (uint)size);
        }
        finally { Marshal.FreeHGlobal(ptr); }
    }

    static void WriteLine(string json) { Console.Out.WriteLine(json); Console.Out.Flush(); }

    static JsonBuilder Ok(int id) { return new JsonBuilder().Prop("id", id).Prop("ok", true); }

    static string Error(int id, string message, int win32)
    {
        return new JsonBuilder().Prop("id", id).Prop("ok", false).Prop("error", message).Prop("win32", win32).End();
    }

    static object Require(Dictionary<string, object> msg, string key)
    {
        object value;
        if (!msg.TryGetValue(key, out value) || value == null) throw new InvalidOperationException("missing " + key);
        return value;
    }

    static string OptionalString(Dictionary<string, object> msg, string key)
    {
        object value;
        if (!msg.TryGetValue(key, out value) || value == null) return null;
        return AsString(value);
    }

    static string AsString(object value) { return Convert.ToString(value, CultureInfo.InvariantCulture); }

    static bool AsBool(object value)
    {
        if (value is bool) return (bool)value;
        return Convert.ToBoolean(value, CultureInfo.InvariantCulture);
    }

    static int AsInt(object value) { return checked((int)AsLong(value)); }

    static long AsLong(object value)
    {
        if (value is int) return (int)value;
        if (value is long) return (long)value;
        if (value is decimal) return (long)(decimal)value;
        if (value is double) return (long)(double)value;
        if (value is string) return long.Parse((string)value, CultureInfo.InvariantCulture);
        throw new InvalidOperationException("not a number: " + value.GetType().FullName);
    }

    static string Js(string value)
    {
        if (value == null) return "null";
        StringBuilder sb = new StringBuilder(value.Length + 2);
        sb.Append('"');
        foreach (char c in value)
        {
            if (c == '\\' || c == '"') { sb.Append('\\'); sb.Append(c); }
            else if (c == '\n') sb.Append("\\n");
            else if (c == '\r') sb.Append("\\r");
            else if (c == '\t') sb.Append("\\t");
            else if (c < 32) sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
            else sb.Append(c);
        }
        sb.Append('"');
        return sb.ToString();
    }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern IntPtr CreateJobObject(IntPtr attrs, string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetInformationJobObject(IntPtr job, int cls, IntPtr info, uint length);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool QueryInformationJobObject(IntPtr job, int cls, IntPtr info, uint length, out uint returned);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool TerminateJobObject(IntPtr job, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CreateProcessW(string application, StringBuilder command, IntPtr processAttrs, IntPtr threadAttrs, bool inherit, uint flags, IntPtr env, string cwd, ref StartupInfo startup, out ProcessInformation info);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool TerminateProcess(IntPtr process, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetProcessTimes(IntPtr process, out long creation, out long exit, out long kernel, out long user);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool QueryFullProcessImageNameW(IntPtr process, uint flags, StringBuilder name, ref uint size);
    [DllImport("kernel32.dll")]
    static extern uint GetProcessId(IntPtr process);
    [DllImport("kernel32.dll")]
    static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetProcessHandleCount(IntPtr process, out uint count);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr CreateIoCompletionPort(IntPtr file, IntPtr existing, UIntPtr key, uint threads);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetQueuedCompletionStatus(IntPtr port, out uint bytes, out UIntPtr key, out IntPtr overlapped, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern IntPtr CreateFileW(string name, uint access, uint share, ref SecurityAttributes security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CreatePipe(out IntPtr read, out IntPtr write, ref SecurityAttributes security, uint size);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool ReadFile(IntPtr file, byte[] buffer, uint requested, out uint read, IntPtr overlapped);
    [DllImport("ntdll.dll")]
    static extern int NtQueryInformationProcess(IntPtr process, int cls, IntPtr info, int length, out int returned);

    [StructLayout(LayoutKind.Sequential)]
    struct SecurityAttributes
    {
        public int nLength;
        public IntPtr lpSecurityDescriptor;
        [MarshalAs(UnmanagedType.Bool)]
        public bool bInheritHandle;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct StartupInfo
    {
        public int cb;
        public IntPtr lpReserved;
        public IntPtr lpDesktop;
        public IntPtr lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct ProcessInformation
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public int dwProcessId;
        public int dwThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct BasicLimit
    {
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
    struct IoCounters
    {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
        public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct ExtendedLimit
    {
        public BasicLimit Basic;
        public IoCounters Io;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct BasicAccounting
    {
        public long TotalUserTime;
        public long TotalKernelTime;
        public long ThisPeriodTotalUserTime;
        public long ThisPeriodTotalKernelTime;
        public uint TotalPageFaultCount;
        public uint TotalProcesses;
        public uint ActiveProcesses;
        public uint TotalTerminatedProcesses;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct UiLimit { public uint UIRestrictionsClass; }

    [StructLayout(LayoutKind.Sequential)]
    struct CpuRate { public uint ControlFlags; public uint CpuRateValue; }

    [StructLayout(LayoutKind.Sequential)]
    struct CompletionAssociation { public IntPtr CompletionKey; public IntPtr CompletionPort; }

    sealed class JobRec
    {
        public readonly IntPtr Handle;
        public readonly int ParentId;
        public readonly long Memory;
        public readonly int Active;
        public readonly int Cpu;
        public bool MemoryLimitHit;
        public bool ActiveProcessLimitHit;
        public JobRec(IntPtr handle, int parentId, long memory, int active, int cpu)
        {
            Handle = handle;
            ParentId = parentId;
            Memory = memory;
            Active = active;
            Cpu = cpu;
        }
    }

    sealed class ProcHandles
    {
        public readonly IntPtr Process;
        public readonly IntPtr Thread;
        public readonly int Pid;
        public readonly IntPtr StdoutRead;
        public readonly IntPtr StderrRead;
        public ProcHandles(IntPtr process, IntPtr thread, int pid, IntPtr stdoutRead, IntPtr stderrRead)
        {
            Process = process;
            Thread = thread;
            Pid = pid;
            StdoutRead = stdoutRead;
            StderrRead = stderrRead;
        }
        public void Dispose()
        {
            if (Process != IntPtr.Zero) CloseHandle(Process);
            if (Thread != IntPtr.Zero) CloseHandle(Thread);
            if (StdoutRead != IntPtr.Zero) CloseHandle(StdoutRead);
            if (StderrRead != IntPtr.Zero) CloseHandle(StderrRead);
        }
    }

    sealed class ProcRec
    {
        public readonly int Slot;
        public readonly int JobId;
        public readonly ProcHandles Handles;
        readonly OutputBuffer stdout = new OutputBuffer();
        readonly OutputBuffer stderr = new OutputBuffer();
        public ProcRec(int slot, int jobId, ProcHandles handles, uint pid)
        {
            Slot = slot;
            JobId = jobId;
            Handles = handles;
        }
        public void StartPumps()
        {
            StartPump(Handles.StdoutRead, stdout);
            StartPump(Handles.StderrRead, stderr);
        }
        static void StartPump(IntPtr handle, OutputBuffer buffer)
        {
            if (handle == IntPtr.Zero) return;
            Thread thread = new Thread(() => Pump(handle, buffer));
            thread.IsBackground = true;
            thread.Start();
        }
        static void Pump(IntPtr handle, OutputBuffer buffer)
        {
            byte[] bytes = new byte[4096];
            Decoder decoder = Encoding.UTF8.GetDecoder();
            char[] chars = new char[4096];
            try
            {
                uint read;
                while (ReadFile(handle, bytes, (uint)bytes.Length, out read, IntPtr.Zero) && read > 0)
                {
                    int produced = decoder.GetChars(bytes, 0, (int)read, chars, 0);
                    lock (buffer.Gate)
                    {
                        int room = OutputCap - buffer.Text.Length;
                        if (room <= 0) { buffer.Truncated = true; continue; }
                        if (produced > room)
                        {
                            buffer.Text.Append(chars, 0, room);
                            buffer.Truncated = true;
                        }
                        else buffer.Text.Append(chars, 0, produced);
                    }
                }
            }
            catch (Exception) { }
        }
        public void CopyOutput(out string stdoutText, out string stderrText, out bool stdoutTruncated, out bool stderrTruncated)
        {
            lock (stdout.Gate) { stdoutText = stdout.Text.ToString(); stdoutTruncated = stdout.Truncated; }
            lock (stderr.Gate) { stderrText = stderr.Text.ToString(); stderrTruncated = stderr.Truncated; }
        }
        public void Dispose() { Handles.Dispose(); }
    }

    sealed class OutputBuffer
    {
        public readonly StringBuilder Text = new StringBuilder();
        public readonly object Gate = new object();
        public bool Truncated;
    }

    struct Identity
    {
        public readonly uint Pid;
        public readonly long StartTime;
        public readonly string ImagePath;
        public readonly string CommandLine;
        public Identity(uint pid, long startTime, string imagePath, string commandLine)
        {
            Pid = pid;
            StartTime = startTime;
            ImagePath = imagePath;
            CommandLine = commandLine;
        }
    }

    struct Accounting
    {
        public readonly long UserCpuMs, KernelCpuMs;
        public readonly long TotalPageFaults, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses;
        public Accounting(long user, long kernel, long faults, long total, long active, long terminated)
        {
            UserCpuMs = user; KernelCpuMs = kernel; TotalPageFaults = faults;
            TotalProcesses = total; ActiveProcesses = active; TotalTerminatedProcesses = terminated;
        }
    }

    struct MemoryUsage
    {
        public readonly long Current, Peak;
        public MemoryUsage(long current, long peak) { Current = current; Peak = peak; }
    }

    struct LimitSnapshot
    {
        public readonly long MemoryBytes, ProcessMemoryBytes, PeakJobMemory, PeakProcessMemory;
        public readonly int ActiveProcessLimit;
        public readonly long LimitFlags, UiRestrictions;
        public readonly int CpuRatePercent;
        public readonly bool KillOnJobClose, UiHandlesRestricted;
        public LimitSnapshot(long memory, long processMemory, long peakJob, long peakProcess, int active, long flags, long ui, int cpu, bool kill, bool handles)
        {
            MemoryBytes = memory; ProcessMemoryBytes = processMemory; PeakJobMemory = peakJob; PeakProcessMemory = peakProcess;
            ActiveProcessLimit = active; LimitFlags = flags; UiRestrictions = ui; CpuRatePercent = cpu;
            KillOnJobClose = kill; UiHandlesRestricted = handles;
        }
    }

    sealed class JsonBuilder
    {
        readonly StringBuilder sb = new StringBuilder();
        bool first = true;
        public JsonBuilder() { sb.Append('{'); }
        void Comma() { if (!first) sb.Append(','); first = false; }
        public JsonBuilder Prop(string name, string value) { Comma(); sb.Append('"').Append(name).Append("\":").Append(Js(value)); return this; }
        public JsonBuilder Prop(string name, long value) { Comma(); sb.Append('"').Append(name).Append("\":").Append(value.ToString(CultureInfo.InvariantCulture)); return this; }
        public JsonBuilder Prop(string name, bool value) { Comma(); sb.Append('"').Append(name).Append("\":").Append(value ? "true" : "false"); return this; }
        public JsonBuilder Raw(string name, string rawJson) { Comma(); sb.Append('"').Append(name).Append("\":").Append(rawJson); return this; }
        public string End() { sb.Append('}'); return sb.ToString(); }
    }
}
