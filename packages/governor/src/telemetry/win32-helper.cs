using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

internal static class Win32TelemetryHelper
{
    const uint CREATE_SUSPENDED = 0x00000004;
    const uint CREATE_NO_WINDOW = 0x08000000;
    const uint DETACHED_PROCESS = 0x00000008;
    const uint JOB_OBJECT_QUERY = 0x0004;
    const uint PROCESS_QUERY_INFORMATION = 0x0400;
    const uint PROCESS_VM_READ = 0x0010;
    const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    const uint PROCESS_TERMINATE = 0x0001;
    const uint SYNCHRONIZE = 0x00100000;
    const uint TH32CS_SNAPPROCESS = 0x00000002;
    const int JobObjectBasicAccountingInformation = 1;
    const int JobObjectBasicProcessIdList = 3;
    const int JobObjectExtendedLimitInformation = 9;
    const int JobObjectMemoryUsageInformation = 28;
    const uint PDH_FMT_DOUBLE = 0x00000200;

    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    static readonly object WriteGate = new object();
    static readonly ManualResetEvent ShutdownEvent = new ManualResetEvent(false);
    static IntPtr LowMemoryHandle = IntPtr.Zero;
    static IntPtr PdhQuery = IntPtr.Zero;
    static IntPtr QueueCounter = IntPtr.Zero;
    static IntPtr BusyCounter = IntPtr.Zero;
    static IntPtr DefenderCounter = IntPtr.Zero;
    static bool DefenderPdh = false;
    static bool PdhReady = false;
    static readonly object PdhGate = new object();
    static double CachedQueue;
    static double CachedBusy;
    static bool CachedPdhOk;
    static double CachedDefender;
    static bool CachedDefenderFound;
    static IDXGIFactory1 CachedFactory;
    static IDXGIAdapter3 CachedAdapter;
    static string CachedAdapterName;
    static long CachedShared;
    static bool CachedDiscrete;
    static bool GpuCached;
    static uint DefenderPid;
    static bool DefenderPidKnown;
    static long DefenderCpu;
    static long DefenderStamp;
    static bool DefenderHave;
    static IntPtr ProbeJob = IntPtr.Zero;
    static IntPtr ProbeProcess = IntPtr.Zero;
    static IntPtr ProbeThread = IntPtr.Zero;
    static string ProbeName = "";
    static int ProbePid;
    static bool Running = true;

    static int Main(string[] args)
    {
        Console.InputEncoding = Encoding.UTF8;
        Console.OutputEncoding = Encoding.UTF8;
        int extended = Marshal.SizeOf(typeof(ExtendedLimit));
        if (IntPtr.Size != 8 || extended != 144)
        {
            Console.Error.WriteLine("ExtendedLimit layout is " + extended);
            return 1;
        }
        LowMemoryHandle = CreateMemoryResourceNotification(0);
        Thread watcher = new Thread(WatchLowMemory);
        watcher.IsBackground = true;
        watcher.Start();
        InitPdh();
        Thread pdh = new Thread(WatchPdh);
        pdh.IsBackground = true;
        pdh.Start();
        try { ProbeGpu(); }
        catch (Exception) { GpuCached = true; }
        int parentPid = 0;
        if (args.Length > 0) int.TryParse(args[0], out parentPid);
        if (parentPid > 0)
        {
            Thread parent = new Thread(() => WatchParent(parentPid));
            parent.IsBackground = true;
            parent.Start();
        }
        string line;
        while ((line = Console.ReadLine()) != null)
        {
            if (line.Trim().Length == 0) continue;
            Dispatch(line);
            if (!Running) break;
        }
        Cleanup();
        return 0;
    }

    static void Dispatch(string line)
    {
        Dictionary<string, object> msg = null;
        try
        {
            msg = Json.DeserializeObject(line) as Dictionary<string, object>;
        }
        catch (Exception ex)
        {
            WriteLine(Error(-1, ex.Message));
            return;
        }
        if (msg == null)
        {
            WriteLine(Error(-1, "request is empty"));
            return;
        }
        int id = ToInt(msg, "id");
        string op = ToStr(msg, "op");
        try
        {
            if (op == "ping") WriteLine(new Js().N("id", id).B("ok", true).N("extended", Marshal.SizeOf(typeof(ExtendedLimit))).End());
            else if (op == "shutdown")
            {
                WriteLine(new Js().N("id", id).B("ok", true).End());
                Running = false;
                ShutdownEvent.Set();
            }
            else if (op == "sample") WriteLine(Sample(id, msg));
            else if (op == "createProbeJob") WriteLine(CreateProbe(id));
            else if (op == "closeProbeJob")
            {
                CloseProbe();
                WriteLine(new Js().N("id", id).B("ok", true).End());
            }
            else WriteLine(Error(id, "unknown op"));
        }
        catch (Exception ex)
        {
            WriteLine(Error(id, ex.Message));
        }
    }

    static string Sample(int id, Dictionary<string, object> msg)
    {
        string workspace = ToStr(msg, "workspace");
        string appData = ToStr(msg, "appData");
        bool lowOk = false;
        bool low = false;
        if (LowMemoryHandle != IntPtr.Zero)
        {
            bool state;
            lowOk = QueryMemoryResourceNotification(LowMemoryHandle, out state);
            if (lowOk) low = state;
        }
        string memory = MemoryJson();
        string disk = DiskJson(workspace, appData);
        string gpu = GpuJson();
        string defender = DefenderJson();
        string jobs = JobsJson(msg);
        return new Js()
            .N("id", id)
            .B("ok", true)
            .Raw("memory", memory)
            .B("lowMemory", low)
            .B("lowMemoryOk", lowOk)
            .Raw("disk", disk)
            .Raw("gpu", gpu)
            .Raw("defender", defender)
            .Raw("jobs", jobs)
            .End();
    }

    static string MemoryJson()
    {
        try
        {
            MemoryStatus status = new MemoryStatus();
            status.dwLength = (uint)Marshal.SizeOf(typeof(MemoryStatus));
            if (!GlobalMemoryStatusEx(ref status)) return SectionError("GlobalMemoryStatusEx failed: " + Marshal.GetLastWin32Error());
            return new Js()
                .B("ok", true)
                .N("totalPhys", (long)status.ullTotalPhys)
                .N("availPhys", (long)status.ullAvailPhys)
                .N("totalPage", (long)status.ullTotalPageFile)
                .N("availPage", (long)status.ullAvailPageFile)
                .N("load", status.dwMemoryLoad)
                .S("error", null)
                .End();
        }
        catch (Exception ex)
        {
            return SectionError(ex.Message);
        }
    }

    static string DiskJson(string workspace, string appData)
    {
        double queue = 0;
        double busy = 0;
        bool queueOk = ReadPdh(out queue, out busy);
        return new Js()
            .Raw("workspace", VolumeJson(workspace))
            .Raw("appData", VolumeJson(appData))
            .Raw("queueLength", queueOk ? D(queue) : "null")
            .Raw("ioBusyPercent", queueOk ? D(busy) : "null")
            .B("queueOk", queueOk)
            .End();
    }

    static string VolumeJson(string path)
    {
        try
        {
            ulong free;
            ulong total;
            ulong totalFree;
            if (!GetDiskFreeSpaceEx(path, out free, out total, out totalFree))
            {
                return new Js().B("ok", false).S("path", path).N("free", 0).N("total", 0).S("error", "GetDiskFreeSpaceEx failed: " + Marshal.GetLastWin32Error()).End();
            }
            return new Js().B("ok", true).S("path", path).N("free", (long)free).N("total", (long)total).S("error", null).End();
        }
        catch (Exception ex)
        {
            return new Js().B("ok", false).S("path", path).N("free", 0).N("total", 0).S("error", ex.Message).End();
        }
    }

    static string DefenderJson()
    {
        try
        {
            if (!DefenderPdh && !CachedDefenderFound)
            {
                return new Js().B("ok", true).D("cpuPercent", 0).B("accessDenied", false).B("found", false).S("error", null).End();
            }
            double percent;
            bool found;
            lock (PdhGate)
            {
                percent = CachedDefender;
                found = CachedDefenderFound;
            }
            return new Js().B("ok", true).D("cpuPercent", percent).B("accessDenied", false).B("found", found).S("error", null).End();
        }
        catch (Exception ex)
        {
            return new Js().B("ok", false).D("cpuPercent", 0).B("accessDenied", true).B("found", false).S("error", ex.Message).End();
        }
    }

    static string JobsJson(Dictionary<string, object> msg)
    {
        StringBuilder list = new StringBuilder();
        list.Append('[');
        bool first = true;
        foreach (object entry in Enumerate(msg, "jobs"))
        {
            Dictionary<string, object> job = entry as Dictionary<string, object>;
            if (job == null) continue;
            if (!first) list.Append(',');
            first = false;
            list.Append(JobJson(ToStr(job, "id"), ToStr(job, "name"), ToStr(job, "role")));
        }
        list.Append(']');
        return list.ToString();
    }

    static IEnumerable Enumerate(Dictionary<string, object> msg, string key)
    {
        if (!msg.ContainsKey(key) || msg[key] == null) yield break;
        ArrayList list = msg[key] as ArrayList;
        if (list != null)
        {
            foreach (object entry in list) yield return entry;
            yield break;
        }
        object[] array = msg[key] as object[];
        if (array == null) yield break;
        foreach (object entry in array) yield return entry;
    }

    static string JobJson(string id, string name, string role)
    {
        IntPtr handle = OpenJobObjectW(JOB_OBJECT_QUERY, false, name);
        if (handle == IntPtr.Zero)
        {
            int win32 = Marshal.GetLastWin32Error();
            return new Js()
                .S("id", id)
                .S("name", name)
                .S("role", role)
                .B("ok", false)
                .N("peakJobMemoryUsed", 0)
                .N("currentWorkingSet", 0)
                .N("totalUserTimeMs", 0)
                .N("totalKernelTimeMs", 0)
                .N("activeProcesses", 0)
                .N("win32", win32)
                .S("error", win32 == 5 ? "ACCESS_DENIED" : "OpenJobObject failed")
                .End();
        }
        try
        {
            BasicAccounting accounting = ReadAccounting(handle);
            long peak = ReadPeak(handle);
            long workingSet = SumWorkingSet(handle);
            if (workingSet <= 0) workingSet = ReadJobMemory(handle);
            return new Js()
                .S("id", id)
                .S("name", name)
                .S("role", role)
                .B("ok", true)
                .N("peakJobMemoryUsed", peak)
                .N("currentWorkingSet", workingSet)
                .N("totalUserTimeMs", accounting.TotalUserTime / 10000L)
                .N("totalKernelTimeMs", accounting.TotalKernelTime / 10000L)
                .N("activeProcesses", accounting.ActiveProcesses)
                .N("win32", 0)
                .S("error", null)
                .End();
        }
        catch (Exception ex)
        {
            return new Js()
                .S("id", id)
                .S("name", name)
                .S("role", role)
                .B("ok", false)
                .N("peakJobMemoryUsed", 0)
                .N("currentWorkingSet", 0)
                .N("totalUserTimeMs", 0)
                .N("totalKernelTimeMs", 0)
                .N("activeProcesses", 0)
                .N("win32", Marshal.GetLastWin32Error())
                .S("error", ex.Message)
                .End();
        }
        finally
        {
            CloseHandle(handle);
        }
    }

    static string CreateProbe(int id)
    {
        CloseProbe();
        ProbeName = "Local\\EFHarnessGov117-" + GetCurrentProcessId() + "-" + DateTime.UtcNow.Ticks.ToString(CultureInfo.InvariantCulture);
        ProbeJob = CreateJobObjectW(IntPtr.Zero, ProbeName);
        if (ProbeJob == IntPtr.Zero) throw new InvalidOperationException("CreateJobObjectW failed: " + Marshal.GetLastWin32Error());
        string application = Environment.SystemDirectory + "\\ping.exe";
        string command = "\"" + application + "\" -n 60 127.0.0.1";
        StartupInfo startup = new StartupInfo();
        startup.cb = Marshal.SizeOf(typeof(StartupInfo));
        ProcessInformation info;
        StringBuilder mutable = new StringBuilder(command, 1024);
        bool created = CreateProcessW(application, mutable, IntPtr.Zero, IntPtr.Zero, false, CREATE_SUSPENDED | CREATE_NO_WINDOW | DETACHED_PROCESS, IntPtr.Zero, null, ref startup, out info);
        if (!created) throw new InvalidOperationException("CreateProcessW failed: " + Marshal.GetLastWin32Error());
        ProbeProcess = info.hProcess;
        ProbeThread = info.hThread;
        ProbePid = info.dwProcessId;
        if (!AssignProcessToJobObject(ProbeJob, ProbeProcess))
        {
            int win32 = Marshal.GetLastWin32Error();
            throw new InvalidOperationException("AssignProcessToJobObject failed: " + win32);
        }
        ResumeThread(ProbeThread);
        Thread.Sleep(150);
        return new Js().N("id", id).B("ok", true).S("name", ProbeName).S("jobId", "probe").N("pid", ProbePid).End();
    }

    static void CloseProbe()
    {
        if (ProbeProcess != IntPtr.Zero)
        {
            TerminateProcess(ProbeProcess, 0);
            CloseHandle(ProbeProcess);
            ProbeProcess = IntPtr.Zero;
        }
        if (ProbeThread != IntPtr.Zero)
        {
            CloseHandle(ProbeThread);
            ProbeThread = IntPtr.Zero;
        }
        if (ProbeJob != IntPtr.Zero)
        {
            CloseHandle(ProbeJob);
            ProbeJob = IntPtr.Zero;
        }
        ProbeName = "";
    }

    static void InitPdh()
    {
        try
        {
            uint opened = PdhOpenQueryW(IntPtr.Zero, IntPtr.Zero, out PdhQuery);
            if (opened != 0 || PdhQuery == IntPtr.Zero) return;
            uint queue = PdhAddEnglishCounterW(PdhQuery, @"\PhysicalDisk(_Total)\Current Disk Queue Length", IntPtr.Zero, out QueueCounter);
            uint busy = PdhAddEnglishCounterW(PdhQuery, @"\PhysicalDisk(_Total)\% Disk Time", IntPtr.Zero, out BusyCounter);
            uint defender = PdhAddEnglishCounterW(PdhQuery, @"\Process(MsMpEng)\% Processor Time", IntPtr.Zero, out DefenderCounter);
            DefenderPdh = defender == 0 && DefenderCounter != IntPtr.Zero;
            if (queue != 0 || busy != 0) return;
            PdhCollectQueryData(PdhQuery);
            Thread.Sleep(80);
            uint primed = PdhCollectQueryData(PdhQuery);
            PdhReady = primed == 0 && QueueCounter != IntPtr.Zero && BusyCounter != IntPtr.Zero;
            if (PdhReady) RefreshPdh();
        }
        catch (Exception)
        {
            PdhReady = false;
        }
    }

    static void RefreshPdh()
    {
        if (!PdhReady) return;
        uint collected = PdhCollectQueryData(PdhQuery);
        if (collected != 0) return;
        uint type;
        PdhFmt queueValue;
        PdhFmt busyValue;
        uint queueStatus = PdhGetFormattedCounterValue(QueueCounter, PDH_FMT_DOUBLE, out type, out queueValue);
        uint busyStatus = PdhGetFormattedCounterValue(BusyCounter, PDH_FMT_DOUBLE, out type, out busyValue);
        double queue = 0;
        double busy = 0;
        bool ok = queueStatus == 0 && busyStatus == 0;
        if (ok)
        {
            queue = queueValue.doubleValue < 0 ? 0 : queueValue.doubleValue;
            busy = busyValue.doubleValue < 0 ? 0 : busyValue.doubleValue;
        }
        double defender = 0;
        bool defenderFound = false;
        if (DefenderPdh)
        {
            PdhFmt defenderValue;
            uint defenderStatus = PdhGetFormattedCounterValue(DefenderCounter, PDH_FMT_DOUBLE, out type, out defenderValue);
            if (defenderStatus == 0)
            {
                defender = defenderValue.doubleValue;
                if (defender > 100) defender = defender / Environment.ProcessorCount;
                if (defender < 0) defender = 0;
                if (defender > 100) defender = 100;
                defenderFound = true;
            }
        }
        lock (PdhGate)
        {
            CachedQueue = queue;
            CachedBusy = busy;
            CachedPdhOk = ok;
            CachedDefender = defender;
            CachedDefenderFound = defenderFound;
        }
    }

    static void WatchPdh()
    {
        while (Running)
        {
            try { RefreshPdh(); }
            catch (Exception) { }
            if (ShutdownEvent.WaitOne(1000)) break;
        }
    }

    static bool ReadPdh(out double queue, out double busy)
    {
        lock (PdhGate)
        {
            queue = CachedQueue;
            busy = CachedBusy;
            return CachedPdhOk;
        }
    }

    static string GpuJson()
    {
        try
        {
            if (GpuCached) return QueryCachedGpu();
            return ProbeGpu();
        }
        catch (Exception ex)
        {
            GpuCached = false;
            return new Js()
                .B("ok", true)
                .B("available", false)
                .S("adapterName", null)
                .Raw("budgetBytes", "null")
                .Raw("currentUsageBytes", "null")
                .Raw("availableForReservationBytes", "null")
                .N("sharedVramBudgetBytes", 0)
                .S("error", ex.Message)
                .End();
        }
    }

    static string QueryCachedGpu()
    {
        if (!CachedDiscrete || CachedAdapter == null) return GpuFallback(CachedShared, null);
        VideoMemoryInfo info;
        int queried = CachedAdapter.QueryVideoMemoryInfo(0, 0, out info);
        if (queried < 0)
        {
            GpuCached = false;
            return ProbeGpu();
        }
        return new Js()
            .B("ok", true)
            .B("available", true)
            .S("adapterName", CachedAdapterName)
            .N("budgetBytes", (long)info.Budget)
            .N("currentUsageBytes", (long)info.CurrentUsage)
            .N("availableForReservationBytes", (long)info.AvailableForReservation)
            .N("sharedVramBudgetBytes", CachedShared)
            .S("error", null)
            .End();
    }

    static string ProbeGpu()
    {
        Guid factoryId = new Guid("770aae78-f26f-4dba-a829-253c83d1b387");
        IntPtr rawFactory;
        int hr = CreateDXGIFactory1(ref factoryId, out rawFactory);
        if (hr < 0 || rawFactory == IntPtr.Zero) return GpuFallback(0, null);
        IDXGIFactory1 factory = null;
        try
        {
            factory = (IDXGIFactory1)Marshal.GetObjectForIUnknown(rawFactory);
        }
        catch (Exception)
        {
            Marshal.Release(rawFactory);
            return GpuFallback(0, null);
        }
        Marshal.Release(rawFactory);
        long bestBudget = 0;
        long bestUsage = 0;
        long bestReservation = 0;
        long shared = 0;
        string name = null;
        IDXGIAdapter3 best = null;
        try
        {
            for (uint index = 0; index < 8; index++)
            {
                IntPtr adapterRaw;
                int enumerated = factory.EnumAdapters(index, out adapterRaw);
                if (enumerated < 0 || adapterRaw == IntPtr.Zero) break;
                object adapterObject = null;
                try
                {
                    adapterObject = Marshal.GetObjectForIUnknown(adapterRaw);
                }
                catch (Exception)
                {
                    Marshal.Release(adapterRaw);
                    continue;
                }
                Marshal.Release(adapterRaw);
                IDXGIAdapter3 adapter3 = adapterObject as IDXGIAdapter3;
                if (adapter3 == null)
                {
                    Marshal.ReleaseComObject(adapterObject);
                    continue;
                }
                long adapterShared = 0;
                string adapterName = null;
                if (Marshal.SizeOf(typeof(AdapterDesc)) == 304)
                {
                    AdapterDesc desc;
                    if (adapter3.GetDesc(out desc) >= 0)
                    {
                        adapterName = desc.Description;
                        adapterShared = (long)desc.SharedSystemMemory;
                        if (adapterShared > shared) shared = adapterShared;
                    }
                }
                VideoMemoryInfo info;
                int queried = adapter3.QueryVideoMemoryInfo(0, 0, out info);
                bool keep = false;
                if (queried >= 0 && info.Budget > 0 && adapterShared == 0)
                {
                    if ((long)info.Budget > bestBudget)
                    {
                        bestBudget = (long)info.Budget;
                        bestUsage = (long)info.CurrentUsage;
                        bestReservation = (long)info.AvailableForReservation;
                        name = adapterName;
                        keep = true;
                    }
                }
                else if (queried >= 0 && (long)info.Budget > shared) shared = (long)info.Budget;
                VideoMemoryInfo nonLocal;
                if (adapter3.QueryVideoMemoryInfo(0, 1, out nonLocal) >= 0 && (long)nonLocal.Budget > shared) shared = (long)nonLocal.Budget;
                if (keep)
                {
                    if (best != null) Marshal.ReleaseComObject(best);
                    best = adapter3;
                }
                else Marshal.ReleaseComObject(adapter3);
            }
        }
        finally
        {
            if (best == null && factory != null) Marshal.ReleaseComObject(factory);
        }
        CachedShared = shared;
        CachedAdapterName = name;
        if (best != null)
        {
            CachedFactory = factory;
            CachedAdapter = best;
            CachedDiscrete = true;
            GpuCached = true;
            return new Js()
                .B("ok", true)
                .B("available", true)
                .S("adapterName", name)
                .N("budgetBytes", bestBudget)
                .N("currentUsageBytes", bestUsage)
                .N("availableForReservationBytes", bestReservation)
                .N("sharedVramBudgetBytes", shared)
                .S("error", null)
                .End();
        }
        CachedDiscrete = false;
        GpuCached = true;
        return GpuFallback(shared, null);
    }

    static string GpuFallback(long shared, string error)
    {
        return new Js()
            .B("ok", true)
            .B("available", false)
            .S("adapterName", null)
            .Raw("budgetBytes", "null")
            .Raw("currentUsageBytes", "null")
            .Raw("availableForReservationBytes", "null")
            .N("sharedVramBudgetBytes", shared < 0 ? 0 : shared)
            .S("error", error)
            .End();
    }

    static long ProcessCpu(uint pid, out bool accessDenied)
    {
        accessDenied = false;
        IntPtr process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
        if (process == IntPtr.Zero) process = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, pid);
        if (process == IntPtr.Zero)
        {
            accessDenied = true;
            return -1;
        }
        try
        {
            long created;
            long exited;
            long kernel;
            long user;
            if (!GetProcessTimes(process, out created, out exited, out kernel, out user))
            {
                accessDenied = true;
                return -1;
            }
            return kernel + user;
        }
        finally
        {
            CloseHandle(process);
        }
    }

    static long ReadDefenderCpu(out bool found, out bool accessDenied)
    {
        found = false;
        accessDenied = false;
        if (DefenderPidKnown)
        {
            long cached = ProcessCpu(DefenderPid, out accessDenied);
            if (!accessDenied && cached >= 0)
            {
                found = true;
                return cached;
            }
            DefenderPidKnown = false;
        }
        IntPtr snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if (snap == IntPtr.Zero || snap == new IntPtr(-1))
        {
            accessDenied = true;
            return 0;
        }
        long total = 0;
        int opened = 0;
        int matched = 0;
        try
        {
            ProcessEntry entry = new ProcessEntry();
            entry.dwSize = (uint)Marshal.SizeOf(typeof(ProcessEntry));
            bool more = Process32FirstW(snap, ref entry);
            while (more)
            {
                if (string.Equals(entry.szExeFile, "MsMpEng.exe", StringComparison.OrdinalIgnoreCase))
                {
                    matched++;
                    found = true;
                    IntPtr process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, entry.th32ProcessID);
                    if (process == IntPtr.Zero) process = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, entry.th32ProcessID);
                    if (process == IntPtr.Zero) accessDenied = true;
                    else
                    {
                        long created, exited, kernel, user;
                        if (GetProcessTimes(process, out created, out exited, out kernel, out user))
                        {
                            total += kernel + user;
                            opened++;
                            if (!DefenderPidKnown)
                            {
                                DefenderPid = entry.th32ProcessID;
                                DefenderPidKnown = true;
                            }
                        }
                        CloseHandle(process);
                    }
                }
                entry.dwSize = (uint)Marshal.SizeOf(typeof(ProcessEntry));
                more = Process32NextW(snap, ref entry);
            }
        }
        finally
        {
            CloseHandle(snap);
        }
        if (matched > 0 && opened == 0) accessDenied = true;
        else accessDenied = false;
        return total;
    }

    static double CpuPercent(long cpu)
    {
        long now;
        GetSystemTimeAsFileTime(out now);
        if (!DefenderHave || now <= DefenderStamp)
        {
            DefenderHave = true;
            DefenderStamp = now;
            DefenderCpu = cpu;
            return 0;
        }
        long wall = now - DefenderStamp;
        long used = cpu - DefenderCpu;
        DefenderStamp = now;
        DefenderCpu = cpu;
        if (wall <= 0 || used <= 0) return 0;
        double percent = (double)used / wall / Environment.ProcessorCount * 100.0;
        if (percent < 0) return 0;
        if (percent > 100) return 100;
        return percent;
    }

    static BasicAccounting ReadAccounting(IntPtr job)
    {
        int size = Marshal.SizeOf(typeof(BasicAccounting));
        IntPtr ptr = Marshal.AllocHGlobal(size);
        try
        {
            uint returned;
            if (!QueryInformationJobObject(job, JobObjectBasicAccountingInformation, ptr, (uint)size, out returned))
                throw new InvalidOperationException("accounting query failed: " + Marshal.GetLastWin32Error());
            return (BasicAccounting)Marshal.PtrToStructure(ptr, typeof(BasicAccounting));
        }
        finally
        {
            Marshal.FreeHGlobal(ptr);
        }
    }

    static long ReadPeak(IntPtr job)
    {
        int size = Marshal.SizeOf(typeof(ExtendedLimit));
        IntPtr ptr = Marshal.AllocHGlobal(size);
        try
        {
            uint returned;
            if (!QueryInformationJobObject(job, JobObjectExtendedLimitInformation, ptr, (uint)size, out returned))
                throw new InvalidOperationException("limit query failed: " + Marshal.GetLastWin32Error());
            ExtendedLimit info = (ExtendedLimit)Marshal.PtrToStructure(ptr, typeof(ExtendedLimit));
            return (long)info.PeakJobMemoryUsed.ToUInt64();
        }
        finally
        {
            Marshal.FreeHGlobal(ptr);
        }
    }

    static long ReadJobMemory(IntPtr job)
    {
        IntPtr ptr = Marshal.AllocHGlobal(16);
        try
        {
            uint returned;
            if (!QueryInformationJobObject(job, JobObjectMemoryUsageInformation, ptr, 16, out returned)) return 0;
            return Marshal.ReadInt64(ptr, 0);
        }
        finally
        {
            Marshal.FreeHGlobal(ptr);
        }
    }

    static long SumWorkingSet(IntPtr job)
    {
        int bytes = 8 + IntPtr.Size * 512;
        IntPtr ptr = Marshal.AllocHGlobal(bytes);
        try
        {
            uint returned;
            if (!QueryInformationJobObject(job, JobObjectBasicProcessIdList, ptr, (uint)bytes, out returned)) return 0;
            int listed = Marshal.ReadInt32(ptr, 4);
            long sum = 0;
            for (int i = 0; i < listed; i++)
            {
                long pid = Marshal.ReadInt64(ptr, 8 + i * 8);
                sum += WorkingSetOf((uint)pid);
            }
            return sum;
        }
        finally
        {
            Marshal.FreeHGlobal(ptr);
        }
    }

    static long WorkingSetOf(uint pid)
    {
        IntPtr process = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, pid);
        if (process == IntPtr.Zero) process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
        if (process == IntPtr.Zero) return 0;
        try
        {
            ProcessMemoryCounters counters = new ProcessMemoryCounters();
            counters.cb = (uint)Marshal.SizeOf(typeof(ProcessMemoryCounters));
            if (!GetProcessMemoryInfo(process, ref counters, counters.cb)) return 0;
            return (long)counters.WorkingSetSize;
        }
        finally
        {
            CloseHandle(process);
        }
    }

    static void WatchLowMemory()
    {
        bool last = false;
        while (Running)
        {
            if (ShutdownEvent.WaitOne(200)) break;
            if (LowMemoryHandle == IntPtr.Zero) continue;
            bool state;
            if (!QueryMemoryResourceNotification(LowMemoryHandle, out state)) continue;
            if (state == last) continue;
            last = state;
            WriteLine("{\"event\":\"low-memory\",\"signaled\":" + (state ? "true" : "false") + "}");
        }
    }

    static void WatchParent(int pid)
    {
        IntPtr handle = OpenProcess(SYNCHRONIZE, false, (uint)pid);
        if (handle == IntPtr.Zero) return;
        WaitForSingleObject(handle, 0xFFFFFFFF);
        CloseHandle(handle);
        Environment.Exit(0);
    }

    static void Cleanup()
    {
        Running = false;
        ShutdownEvent.Set();
        CloseProbe();
        if (LowMemoryHandle != IntPtr.Zero) CloseHandle(LowMemoryHandle);
        if (PdhQuery != IntPtr.Zero) PdhCloseQuery(PdhQuery);
    }

    static string SectionError(string error)
    {
        return new Js().B("ok", false).N("totalPhys", 0).N("availPhys", 0).N("totalPage", 0).N("availPage", 0).N("load", 0).S("error", error).End();
    }

    static string Error(int id, string message)
    {
        return new Js().N("id", id).B("ok", false).S("error", message).End();
    }

    static int ToInt(Dictionary<string, object> msg, string key)
    {
        if (!msg.ContainsKey(key) || msg[key] == null) return 0;
        return Convert.ToInt32(msg[key], CultureInfo.InvariantCulture);
    }

    static string ToStr(Dictionary<string, object> msg, string key)
    {
        if (!msg.ContainsKey(key) || msg[key] == null) return "";
        return Convert.ToString(msg[key], CultureInfo.InvariantCulture);
    }

    static string D(double value)
    {
        if (double.IsNaN(value) || double.IsInfinity(value) || value < 0) return "0";
        return value.ToString("0.###", CultureInfo.InvariantCulture);
    }

    static void WriteLine(string line)
    {
        lock (WriteGate)
        {
            Console.WriteLine(line);
            Console.Out.Flush();
        }
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr CreateMemoryResourceNotification(int notificationType);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool QueryMemoryResourceNotification(IntPtr handle, out bool resourceState);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GlobalMemoryStatusEx(ref MemoryStatus buffer);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool GetDiskFreeSpaceEx(string directory, out ulong freeBytesAvailable, out ulong totalBytes, out ulong totalFreeBytes);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr OpenJobObjectW(uint desiredAccess, bool inherit, string name);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool QueryInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length, out uint returned);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CreateProcessW(string application, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string cwd, ref StartupInfo startup, out ProcessInformation information);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint ResumeThread(IntPtr thread);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool TerminateProcess(IntPtr process, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr OpenProcess(uint access, bool inherit, uint processId);

    [DllImport("kernel32.dll")]
    static extern uint GetCurrentProcessId();

    [DllImport("kernel32.dll")]
    static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

    [DllImport("kernel32.dll")]
    static extern void GetSystemTimeAsFileTime(out long time);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint processId);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool Process32FirstW(IntPtr snapshot, ref ProcessEntry entry);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool Process32NextW(IntPtr snapshot, ref ProcessEntry entry);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetProcessTimes(IntPtr process, out long creation, out long exit, out long kernel, out long user);

    [DllImport("psapi.dll", SetLastError = true)]
    static extern bool GetProcessMemoryInfo(IntPtr process, ref ProcessMemoryCounters counters, uint size);

    [DllImport("pdh.dll", CharSet = CharSet.Unicode)]
    static extern uint PdhOpenQueryW(IntPtr dataSource, IntPtr userData, out IntPtr query);

    [DllImport("pdh.dll", CharSet = CharSet.Unicode)]
    static extern uint PdhAddEnglishCounterW(IntPtr query, string path, IntPtr userData, out IntPtr counter);

    [DllImport("pdh.dll")]
    static extern uint PdhCollectQueryData(IntPtr query);

    [DllImport("pdh.dll")]
    static extern uint PdhGetFormattedCounterValue(IntPtr counter, uint format, out uint type, out PdhFmt value);

    [DllImport("pdh.dll")]
    static extern uint PdhCloseQuery(IntPtr query);

    [DllImport("dxgi.dll")]
    static extern int CreateDXGIFactory1(ref Guid riid, out IntPtr factory);

    [StructLayout(LayoutKind.Sequential)]
    struct MemoryStatus
    {
        public uint dwLength;
        public uint dwMemoryLoad;
        public ulong ullTotalPhys;
        public ulong ullAvailPhys;
        public ulong ullTotalPageFile;
        public ulong ullAvailPageFile;
        public ulong ullTotalVirtual;
        public ulong ullAvailVirtual;
        public ulong ullAvailExtendedVirtual;
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
    struct PdhFmt
    {
        public uint CStatus;
        public double doubleValue;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct AdapterDesc
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string Description;
        public uint VendorId;
        public uint DeviceId;
        public uint SubSysId;
        public uint Revision;
        public ulong DedicatedVideoMemory;
        public ulong DedicatedSystemMemory;
        public ulong SharedSystemMemory;
        public uint LuidLow;
        public int LuidHigh;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct VideoMemoryInfo
    {
        public ulong Budget;
        public ulong CurrentUsage;
        public ulong AvailableForReservation;
        public ulong CurrentReservation;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct ProcessEntry
    {
        public uint dwSize;
        public uint cntUsage;
        public uint th32ProcessID;
        public IntPtr th32DefaultHeapID;
        public uint th32ModuleID;
        public uint cntThreads;
        public uint th32ParentProcessID;
        public int pcPriClassBase;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string szExeFile;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct ProcessMemoryCounters
    {
        public uint cb;
        public uint PageFaultCount;
        public ulong PeakWorkingSetSize;
        public ulong WorkingSetSize;
        public ulong QuotaPeakPagedPoolUsage;
        public ulong QuotaPagedPoolUsage;
        public ulong QuotaPeakNonPagedPoolUsage;
        public ulong QuotaNonPagedPoolUsage;
        public ulong PagefileUsage;
        public ulong PeakPagefileUsage;
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

    [ComImport, Guid("770aae78-f26f-4dba-a829-253c83d1b387"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IDXGIFactory1
    {
        [PreserveSig] int SetPrivateData(ref Guid name, uint dataSize, IntPtr data);
        [PreserveSig] int SetPrivateDataInterface(ref Guid name, IntPtr unknown);
        [PreserveSig] int GetPrivateData(ref Guid name, ref uint dataSize, IntPtr data);
        [PreserveSig] int GetParent(ref Guid iid, out IntPtr parent);
        [PreserveSig] int EnumAdapters(uint index, out IntPtr adapter);
    }

    [ComImport, Guid("645967A4-1392-4310-A798-8053CE3E93FD"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IDXGIAdapter3
    {
        [PreserveSig] int SetPrivateData(ref Guid name, uint dataSize, IntPtr data);
        [PreserveSig] int SetPrivateDataInterface(ref Guid name, IntPtr unknown);
        [PreserveSig] int GetPrivateData(ref Guid name, ref uint dataSize, IntPtr data);
        [PreserveSig] int GetParent(ref Guid iid, out IntPtr parent);
        [PreserveSig] int EnumOutputs(uint index, out IntPtr output);
        [PreserveSig] int GetDesc(out AdapterDesc desc);
        [PreserveSig] int CheckInterfaceSupport(ref Guid iface, out long umdVersion);
        [PreserveSig] int GetDesc1(IntPtr desc);
        [PreserveSig] int GetDesc2(IntPtr desc);
        [PreserveSig] int RegisterHardwareContentProtectionStatusEvent(IntPtr eventHandle, out uint cookie);
        [PreserveSig] int UnregisterHardwareContentProtectionStatus(uint cookie);
        [PreserveSig] int QueryVideoMemoryInfo(uint nodeIndex, int segmentGroup, out VideoMemoryInfo info);
    }

    sealed class Js
    {
        readonly StringBuilder sb = new StringBuilder();
        bool first = true;

        public Js()
        {
            sb.Append('{');
        }

        void Comma()
        {
            if (!first) sb.Append(',');
            first = false;
        }

        public Js S(string name, string value)
        {
            Comma();
            sb.Append('"').Append(name).Append("\":");
            if (value == null) sb.Append("null");
            else sb.Append(Quote(value));
            return this;
        }

        public Js N(string name, long value)
        {
            Comma();
            sb.Append('"').Append(name).Append("\":").Append(value.ToString(CultureInfo.InvariantCulture));
            return this;
        }

        public Js D(string name, double value)
        {
            Comma();
            sb.Append('"').Append(name).Append("\":").Append(DNumber(value));
            return this;
        }

        public Js B(string name, bool value)
        {
            Comma();
            sb.Append('"').Append(name).Append("\":").Append(value ? "true" : "false");
            return this;
        }

        public Js Raw(string name, string json)
        {
            Comma();
            sb.Append('"').Append(name).Append("\":").Append(json);
            return this;
        }

        public string End()
        {
            sb.Append('}');
            return sb.ToString();
        }

        static string DNumber(double value)
        {
            if (double.IsNaN(value) || double.IsInfinity(value)) return "0";
            return value.ToString("0.###", CultureInfo.InvariantCulture);
        }

        static string Quote(string value)
        {
            StringBuilder escaped = new StringBuilder(value.Length + 2);
            escaped.Append('"');
            for (int i = 0; i < value.Length; i++)
            {
                char c = value[i];
                if (c == '\\' || c == '"')
                {
                    escaped.Append('\\');
                    escaped.Append(c);
                }
                else if (c == '\n') escaped.Append("\\n");
                else if (c == '\r') escaped.Append("\\r");
                else if (c < 32) escaped.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                else escaped.Append(c);
            }
            escaped.Append('"');
            return escaped.ToString();
        }
    }
}
