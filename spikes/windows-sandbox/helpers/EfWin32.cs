using System;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Web.Script.Serialization;

public static class EfWin32
{
    const uint TOKEN_QUERY = 0x0008;
    const uint TOKEN_DUPLICATE = 0x0002;
    const uint TOKEN_ADJUST_DEFAULT = 0x0080;
    const uint TOKEN_ADJUST_PRIVILEGES = 0x0020;
    const uint TOKEN_ASSIGN_PRIMARY = 0x0001;
    const uint SE_PRIVILEGE_ENABLED = 0x2;
    const uint GENERIC_ALL = 0x10000000;
    const int GRANT_ACCESS = 1;
    const int TRUSTEE_IS_SID = 0;
    const uint DISABLE_MAX_PRIVILEGE = 0x1;
    const uint LUA_TOKEN = 0x4;
    const uint WRITE_RESTRICTED = 0x8;
    const uint SE_GROUP_LOGON_ID = 0xC0000000;
    const uint CREATE_SUSPENDED = 0x00000004;
    const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
    const uint CREATE_NO_WINDOW = 0x08000000;
    const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
    const uint PROCESS_SET_QUOTA = 0x0100;
    const uint PROCESS_TERMINATE = 0x0001;
    const uint PROCESS_QUERY_LIMITED = 0x1000;
    const uint LOAD_LIBRARY_SEARCH_SYSTEM32 = 0x00000800;
    const uint WAIT_OBJECT_0 = 0;
    const uint WAIT_TIMEOUT = 0x00000102;
    const int TokenGroups = 2;
    const int TokenElevation = 20;
    const int TokenDefaultDacl = 6;
    const int JobObjectBasicUIRestrictions = 4;
    const int JobObjectExtendedLimitInformation = 9;

    static readonly Dictionary<string, IntPtr> Jobs = new Dictionary<string, IntPtr>();
    static int jobSequence;

    [StructLayout(LayoutKind.Sequential)]
    struct SidAndAttributes
    {
        public IntPtr Sid;
        public uint Attributes;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct Trustee
    {
        public IntPtr pMultipleTrustee;
        public int MultipleTrusteeOperation;
        public int TrusteeForm;
        public int TrusteeType;
        public IntPtr ptstrName;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct ExplicitAccess
    {
        public uint grfAccessPermissions;
        public int grfAccessMode;
        public uint grfInheritance;
        public Trustee Trustee;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct Luid
    {
        public uint LowPart;
        public int HighPart;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct LuidAndAttributes
    {
        public Luid Luid;
        public uint Attributes;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct TokenPrivileges
    {
        public uint PrivilegeCount;
        public LuidAndAttributes Privileges;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct StartupInfo
    {
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
    struct ProcessInformation
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public int dwProcessId;
        public int dwThreadId;
    }

    [DllImport("kernel32.dll")]
    static extern IntPtr GetCurrentProcess();

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr handle);

    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool OpenProcessToken(IntPtr processHandle, uint desiredAccess, out IntPtr tokenHandle);

    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool GetTokenInformation(IntPtr tokenHandle, int tokenInformationClass, IntPtr tokenInformation, int tokenInformationLength, out int returnLength);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool ConvertStringSidToSid(string stringSid, out IntPtr sid);

    [DllImport("kernel32.dll")]
    static extern IntPtr LocalFree(IntPtr handle);

    [DllImport("advapi32.dll", SetLastError = true)]
    static extern int GetLengthSid(IntPtr sid);

    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool CopySid(int destinationLength, IntPtr destination, IntPtr source);

    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool CreateRestrictedToken(
        IntPtr existingToken,
        uint flags,
        uint disableSidCount,
        IntPtr sidsToDisable,
        uint deletePrivilegeCount,
        IntPtr privilegesToDelete,
        uint restrictedSidCount,
        SidAndAttributes[] sidsToRestrict,
        out IntPtr newToken);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern uint SetEntriesInAcl(uint count, ExplicitAccess[] entries, IntPtr oldAcl, out IntPtr newAcl);

    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool SetTokenInformation(IntPtr tokenHandle, int tokenInformationClass, IntPtr tokenInformation, int tokenInformationLength);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool LookupPrivilegeValue(string systemName, string name, out Luid luid);

    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool AdjustTokenPrivileges(IntPtr token, bool disableAll, ref TokenPrivileges newState, int bufferLength, IntPtr previous, IntPtr returnLength);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CreateProcessAsUser(
        IntPtr token,
        string applicationName,
        StringBuilder commandLine,
        IntPtr processAttributes,
        IntPtr threadAttributes,
        bool inheritHandles,
        uint creationFlags,
        IntPtr environment,
        string currentDirectory,
        ref StartupInfo startupInfo,
        out ProcessInformation processInformation);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CreateProcessWithTokenW(
        IntPtr token,
        uint logonFlags,
        string applicationName,
        StringBuilder commandLine,
        uint creationFlags,
        IntPtr environment,
        string currentDirectory,
        ref StartupInfo startupInfo,
        out ProcessInformation processInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool TerminateProcess(IntPtr process, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint ResumeThread(IntPtr thread);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateJobObject(IntPtr attributes, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr OpenProcess(uint desiredAccess, bool inherit, int processId);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr LoadLibraryEx(string fileName, IntPtr file, uint flags);

    [DllImport("kernel32.dll", CharSet = CharSet.Ansi, SetLastError = true)]
    static extern IntPtr GetProcAddress(IntPtr module, string procName);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool FreeLibrary(IntPtr module);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateDesktop(string name, IntPtr device, IntPtr devmode, uint flags, uint desiredAccess, IntPtr security);

    [DllImport("user32.dll", SetLastError = true)]
    static extern bool CloseDesktop(IntPtr desktop);

    public static string Dispatch(string json)
    {
        object id = null;
        try
        {
            var serializer = new JavaScriptSerializer();
            serializer.MaxJsonLength = int.MaxValue;
            var data = serializer.Deserialize<Dictionary<string, object>>(json);
            if (data == null || !data.ContainsKey("op")) return Fail(null, "missing_op", 0, "request has no op");
            id = data.ContainsKey("id") ? data["id"] : null;
            var op = Convert.ToString(data["op"]);
            switch (op)
            {
                case "ping":
                    return Ok(id, new Dictionary<string, object> { { "op", "ping" } });
                case "probe-mxc":
                    return ProbeMxc(id);
                case "probe-elevation":
                    return ProbeElevation(id);
                case "probe-desktop":
                    return ProbeDesktop(id);
                case "probe-token":
                    return ProbeToken(id);
                case "job-open":
                    return JobOpen(id);
                case "job-assign":
                    return JobAssign(id, Convert.ToString(data["job"]), Convert.ToInt32(data["pid"]));
                case "job-close":
                    return JobClose(id, Convert.ToString(data["job"]));
                case "acl-grant":
                    GrantDirectory(Convert.ToString(data["path"]), new SecurityIdentifier(Convert.ToString(data["sid"])));
                    return Ok(id, new Dictionary<string, object> { { "granted", true } });
                case "acl-contains":
                    return Ok(id, new Dictionary<string, object> { { "present", AclContains(Convert.ToString(data["path"]), Convert.ToString(data["sid"])) } });
                case "spawn-restricted":
                    return SpawnRestricted(id, data);
                default:
                    return Fail(id, "unknown_op", 0, op);
            }
        }
        catch (Exception ex)
        {
            return Fail(id, "exception", 0, ex.GetType().Name + ": " + ex.Message);
        }
    }

    static string ProbeMxc(object id)
    {
        var systemRoot = Environment.GetEnvironmentVariable("SystemRoot") ?? @"C:\Windows";
        var dllPath = Path.Combine(systemRoot, "System32", "processmodel.dll");
        var filePresent = File.Exists(dllPath);
        var module = LoadLibraryEx("processmodel.dll", IntPtr.Zero, LOAD_LIBRARY_SEARCH_SYSTEM32);
        var win32 = module == IntPtr.Zero ? Marshal.GetLastWin32Error() : 0;
        var export = IntPtr.Zero;
        if (module != IntPtr.Zero)
        {
            export = GetProcAddress(module, "Experimental_CreateProcessInSandbox");
            if (export == IntPtr.Zero) win32 = Marshal.GetLastWin32Error();
            FreeLibrary(module);
        }
        return Ok(id, new Dictionary<string, object> {
            { "dllPath", dllPath },
            { "filePresent", filePresent },
            { "loaded", module != IntPtr.Zero },
            { "exportPresent", export != IntPtr.Zero },
            { "win32", win32 },
            { "detail", export != IntPtr.Zero
                ? "Experimental_CreateProcessInSandbox is exported. The spike does not call it without a compiled SBOX FlatBuffer."
                : "processmodel.dll export Experimental_CreateProcessInSandbox is absent" }
        });
    }

    static string ProbeElevation(object id)
    {
        var identity = WindowsIdentity.GetCurrent();
        var principal = new WindowsPrincipal(identity);
        var admin = principal.IsInRole(WindowsBuiltInRole.Administrator);
        var elevated = false;
        var win32 = 0;
        IntPtr token;
        if (OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, out token))
        {
            var buffer = Marshal.AllocHGlobal(4);
            try
            {
                int length;
                if (GetTokenInformation(token, TokenElevation, buffer, 4, out length))
                {
                    elevated = Marshal.ReadInt32(buffer) != 0;
                }
                else
                {
                    win32 = Marshal.GetLastWin32Error();
                }
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
                CloseHandle(token);
            }
        }
        else
        {
            win32 = Marshal.GetLastWin32Error();
        }
        return Ok(id, new Dictionary<string, object> {
            { "adminGroup", admin },
            { "elevated", elevated },
            { "win32", win32 }
        });
    }

    static string ProbeDesktop(object id)
    {
        var name = "EFHSpike" + Guid.NewGuid().ToString("N").Substring(0, 8);
        var desktop = CreateDesktop(name, IntPtr.Zero, IntPtr.Zero, 0, 0x000F01FF, IntPtr.Zero);
        var win32 = desktop == IntPtr.Zero ? Marshal.GetLastWin32Error() : 0;
        if (desktop != IntPtr.Zero) CloseDesktop(desktop);
        return Ok(id, new Dictionary<string, object> {
            { "createDesktop", desktop != IntPtr.Zero },
            { "win32", win32 },
            { "win32Message", win32 == 0 ? "" : new Win32Exception(win32).Message },
            { "sendInputIsolated", false },
            { "detail", "CreateDesktop does not move this process off the interactive desktop. Job UI limits and a same-user token do not stop SendInput into the developer's windows. A separate window station with a DACL that excludes the sandbox identity is required, and creating that window station is often denied without extra privileges." }
        });
    }

    static string ProbeToken(object id)
    {
        IntPtr token;
        string sid;
        string error;
        if (!TryCreateRestrictedToken(out token, out sid, out error))
        {
            return Fail(id, "restricted_token_unavailable", 0, error);
        }
        CloseHandle(token);
        return Ok(id, new Dictionary<string, object> {
            { "supported", true },
            { "sid", sid }
        });
    }

    static string JobOpen(object id)
    {
        var job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) return Fail(id, "create_job", Marshal.GetLastWin32Error(), "CreateJobObject failed");
        string limitError;
        if (!ConfigureJob(job, out limitError))
        {
            CloseHandle(job);
            return Fail(id, "configure_job", Marshal.GetLastWin32Error(), limitError);
        }
        jobSequence += 1;
        var key = "job-" + jobSequence.ToString();
        Jobs[key] = job;
        return Ok(id, new Dictionary<string, object> {
            { "job", key },
            { "killOnJobClose", true },
            { "uiRestrictionsSet", true }
        });
    }

    static string JobAssign(object id, string jobId, int pid)
    {
        IntPtr job;
        if (!Jobs.TryGetValue(jobId ?? "", out job)) return Fail(id, "unknown_job", 0, jobId);
        var access = PROCESS_SET_QUOTA | PROCESS_TERMINATE | PROCESS_QUERY_LIMITED;
        var process = OpenProcess(access, false, pid);
        if (process == IntPtr.Zero)
        {
            var win32 = Marshal.GetLastWin32Error();
            return Fail(id, "open_process", win32, new Win32Exception(win32).Message);
        }
        try
        {
            if (!AssignProcessToJobObject(job, process))
            {
                var win32 = Marshal.GetLastWin32Error();
                return Fail(id, "assign_job", win32, new Win32Exception(win32).Message);
            }
        }
        finally
        {
            CloseHandle(process);
        }
        return Ok(id, new Dictionary<string, object> { { "job", jobId }, { "pid", pid } });
    }

    static string JobClose(object id, string jobId)
    {
        IntPtr job;
        if (!Jobs.TryGetValue(jobId ?? "", out job)) return Fail(id, "unknown_job", 0, jobId);
        Jobs.Remove(jobId);
        var closedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var closed = CloseHandle(job);
        return Ok(id, new Dictionary<string, object> {
            { "job", jobId },
            { "closed", closed },
            { "closedAtUnixMs", closedAt }
        });
    }

    static bool AclContains(string path, string sidText)
    {
        AuthorizationRuleCollection rules = Directory.Exists(path)
            ? new DirectoryInfo(path).GetAccessControl().GetAccessRules(true, true, typeof(SecurityIdentifier))
            : new FileInfo(path).GetAccessControl().GetAccessRules(true, true, typeof(SecurityIdentifier));
        foreach (FileSystemAccessRule rule in rules)
        {
            if (string.Equals(rule.IdentityReference.Value, sidText, StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
    }

    static string SpawnRestricted(object id, Dictionary<string, object> data)
    {
        var application = Convert.ToString(data["application"]);
        var commandLine = Convert.ToString(data["commandLine"]);
        var cwd = Convert.ToString(data["cwd"]);
        var timeoutMs = data.ContainsKey("timeoutMs") ? Convert.ToInt32(data["timeoutMs"]) : 20000;
        var grantDirs = StringList(data, "grantDirs");
        var denyDirs = StringList(data, "denyDirs");
        var denyFiles = StringList(data, "denyFiles");
        var envPairs = StringList(data, "env");
        IntPtr token = IntPtr.Zero;
        IntPtr job = IntPtr.Zero;
        IntPtr process = IntPtr.Zero;
        IntPtr thread = IntPtr.Zero;
        IntPtr environment = IntPtr.Zero;
        string sid = null;
        var touched = new List<string>();
        try
        {
            string tokenError;
            if (!TryCreateRestrictedToken(out token, out sid, out tokenError))
            {
                return Fail(id, "restricted_token_unavailable", 0, tokenError);
            }
            var account = new SecurityIdentifier(sid);
            foreach (var dir in grantDirs)
            {
                GrantDirectory(dir, account);
                touched.Add(dir);
            }
            foreach (var dir in denyDirs)
            {
                DenyDirectory(dir, account);
                touched.Add(dir);
            }
            foreach (var file in denyFiles)
            {
                DenyFile(file, account);
                touched.Add(file);
            }
            job = CreateJobObject(IntPtr.Zero, null);
            if (job == IntPtr.Zero) return Fail(id, "create_job", Marshal.GetLastWin32Error(), "CreateJobObject failed");
            string jobError;
            if (!ConfigureJob(job, out jobError)) return Fail(id, "configure_job", Marshal.GetLastWin32Error(), jobError);
            environment = BuildEnvironment(envPairs);
            var flags = CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW;
            ProcessInformation info;
            string launchApi;
            int launchWin32;
            if (!TryLaunch(token, application, commandLine, cwd, environment, flags, out info, out launchApi, out launchWin32))
            {
                return Fail(id, "create_process", launchWin32, launchApi + ": " + new Win32Exception(launchWin32).Message);
            }
            process = info.hProcess;
            thread = info.hThread;
            if (!AssignProcessToJobObject(job, process))
            {
                var win32 = Marshal.GetLastWin32Error();
                TerminateProcess(process, 1);
                return Fail(id, "assign_job", win32, new Win32Exception(win32).Message);
            }
            if (ResumeThread(thread) == 0xFFFFFFFF)
            {
                var win32 = Marshal.GetLastWin32Error();
                TerminateProcess(process, 1);
                return Fail(id, "resume_thread", win32, new Win32Exception(win32).Message);
            }
            var wait = WaitForSingleObject(process, (uint)Math.Max(1, timeoutMs));
            if (wait == WAIT_TIMEOUT)
            {
                TerminateProcess(process, 1);
                WaitForSingleObject(process, 5000);
            }
            uint exitCode;
            if (!GetExitCodeProcess(process, out exitCode)) exitCode = 0xFFFFFFFF;
            var closedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            return Ok(id, new Dictionary<string, object> {
                { "exitCode", unchecked((int)exitCode) },
                { "pid", info.dwProcessId },
                { "sid", sid },
                { "launchApi", launchApi },
                { "timedOut", wait == WAIT_TIMEOUT },
                { "wait", wait },
                { "defaultDacl", true },
                { "defaultDaclDetail", "" },
                { "jobClosedAtUnixMs", closedAt },
                { "killOnJobClose", true }
            });
        }
        catch (Exception ex)
        {
            if (process != IntPtr.Zero) TerminateProcess(process, 1);
            return Fail(id, "spawn_restricted", Marshal.GetLastWin32Error(), ex.GetType().Name + ": " + ex.Message);
        }
        finally
        {
            if (environment != IntPtr.Zero) Marshal.FreeHGlobal(environment);
            if (thread != IntPtr.Zero) CloseHandle(thread);
            if (process != IntPtr.Zero) CloseHandle(process);
            if (job != IntPtr.Zero) CloseHandle(job);
            if (token != IntPtr.Zero) CloseHandle(token);
            if (sid != null)
            {
                var account = new SecurityIdentifier(sid);
                foreach (var path in touched)
                {
                    try { Purge(path, account); } catch (Exception) { }
                }
            }
        }
    }

    static bool TryLaunch(IntPtr token, string application, string commandLine, string cwd, IntPtr environment, uint flags, out ProcessInformation info, out string api, out int win32)
    {
        var startup = new StartupInfo();
        startup.cb = Marshal.SizeOf(typeof(StartupInfo));
        startup.lpDesktop = "WinSta0\\Default";
        var mutable = new StringBuilder(commandLine, Math.Max(32768, commandLine.Length + 16));
        if (CreateProcessAsUser(token, application, mutable, IntPtr.Zero, IntPtr.Zero, false, flags, environment, cwd, ref startup, out info))
        {
            api = "CreateProcessAsUserW";
            win32 = 0;
            return true;
        }
        win32 = Marshal.GetLastWin32Error();
        var first = win32;
        mutable = new StringBuilder(commandLine, Math.Max(32768, commandLine.Length + 16));
        if (CreateProcessWithTokenW(token, 0, application, mutable, flags, environment, cwd, ref startup, out info))
        {
            api = "CreateProcessWithTokenW";
            win32 = 0;
            return true;
        }
        api = "CreateProcessAsUserW win32 " + first.ToString() + "; CreateProcessWithTokenW";
        win32 = Marshal.GetLastWin32Error();
        info = new ProcessInformation();
        return false;
    }

    static bool TryCreateRestrictedToken(out IntPtr newToken, out string sidText, out string error)
    {
        newToken = IntPtr.Zero;
        sidText = null;
        error = null;
        IntPtr baseToken;
        if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY | TOKEN_DUPLICATE | TOKEN_ADJUST_DEFAULT | TOKEN_ADJUST_PRIVILEGES | TOKEN_ASSIGN_PRIMARY, out baseToken))
        {
            error = "OpenProcessToken failed: " + Marshal.GetLastWin32Error().ToString();
            return false;
        }
        IntPtr groups = IntPtr.Zero;
        IntPtr logonCopy = IntPtr.Zero;
        IntPtr everyone = IntPtr.Zero;
        IntPtr cap = IntPtr.Zero;
        try
        {
            int needed;
            GetTokenInformation(baseToken, TokenGroups, IntPtr.Zero, 0, out needed);
            if (needed <= 0)
            {
                error = "TokenGroups size failed: " + Marshal.GetLastWin32Error().ToString();
                return false;
            }
            groups = Marshal.AllocHGlobal(needed);
            if (!GetTokenInformation(baseToken, TokenGroups, groups, needed, out needed))
            {
                error = "GetTokenInformation TokenGroups failed: " + Marshal.GetLastWin32Error().ToString();
                return false;
            }
            var logon = FindLogonSid(groups);
            if (logon == IntPtr.Zero)
            {
                error = "logon SID was not present on the process token";
                return false;
            }
            logonCopy = CopySidBytes(logon);
            sidText = NewCapSid();
            if (!ConvertStringSidToSid(sidText, out cap))
            {
                error = "ConvertStringSidToSid capability failed: " + Marshal.GetLastWin32Error().ToString();
                return false;
            }
            if (!ConvertStringSidToSid("S-1-1-0", out everyone))
            {
                error = "ConvertStringSidToSid Everyone failed: " + Marshal.GetLastWin32Error().ToString();
                return false;
            }
            var restrict = new SidAndAttributes[3];
            restrict[0].Sid = cap;
            restrict[0].Attributes = 0;
            restrict[1].Sid = logonCopy;
            restrict[1].Attributes = 0;
            restrict[2].Sid = everyone;
            restrict[2].Attributes = 0;
            if (!CreateRestrictedToken(baseToken, DISABLE_MAX_PRIVILEGE | LUA_TOKEN | WRITE_RESTRICTED, 0, IntPtr.Zero, 0, IntPtr.Zero, 3, restrict, out newToken))
            {
                error = "CreateRestrictedToken failed: " + Marshal.GetLastWin32Error().ToString();
                return false;
            }
            string daclError;
            if (!TrySetDefaultDacl(newToken, new[] { logonCopy, everyone, cap }, out daclError))
            {
                error = daclError;
                CloseHandle(newToken);
                newToken = IntPtr.Zero;
                return false;
            }
            string privilegeError;
            if (!TryEnablePrivilege(newToken, "SeChangeNotifyPrivilege", out privilegeError))
            {
                error = privilegeError;
                CloseHandle(newToken);
                newToken = IntPtr.Zero;
                return false;
            }
            return true;
        }
        finally
        {
            CloseHandle(baseToken);
            if (groups != IntPtr.Zero) Marshal.FreeHGlobal(groups);
            if (logonCopy != IntPtr.Zero) Marshal.FreeHGlobal(logonCopy);
            if (everyone != IntPtr.Zero) LocalFree(everyone);
            if (cap != IntPtr.Zero) LocalFree(cap);
        }
    }

    static IntPtr FindLogonSid(IntPtr groups)
    {
        var count = Marshal.ReadInt32(groups);
        var offset = IntPtr.Size == 8 ? 8 : 4;
        for (var i = 0; i < count; i++)
        {
            var sid = Marshal.ReadIntPtr(groups, offset);
            var attributes = (uint)Marshal.ReadInt32(groups, offset + IntPtr.Size);
            if ((attributes & SE_GROUP_LOGON_ID) == SE_GROUP_LOGON_ID) return sid;
            offset += IntPtr.Size * 2;
        }
        return IntPtr.Zero;
    }

    static IntPtr CopySidBytes(IntPtr source)
    {
        var length = GetLengthSid(source);
        if (length <= 0) throw new Win32Exception(Marshal.GetLastWin32Error());
        var destination = Marshal.AllocHGlobal(length);
        if (!CopySid(length, destination, source))
        {
            var win32 = Marshal.GetLastWin32Error();
            Marshal.FreeHGlobal(destination);
            throw new Win32Exception(win32);
        }
        return destination;
    }

    static string NewCapSid()
    {
        var bytes = new byte[16];
        using (var rng = RandomNumberGenerator.Create())
        {
            rng.GetBytes(bytes);
        }
        return "S-1-5-21-"
            + BitConverter.ToUInt32(bytes, 0).ToString()
            + "-"
            + BitConverter.ToUInt32(bytes, 4).ToString()
            + "-"
            + BitConverter.ToUInt32(bytes, 8).ToString()
            + "-"
            + BitConverter.ToUInt32(bytes, 12).ToString();
    }

    static bool TrySetDefaultDacl(IntPtr token, IntPtr[] sids, out string error)
    {
        error = null;
        var entries = new ExplicitAccess[sids.Length];
        for (var i = 0; i < sids.Length; i++)
        {
            entries[i].grfAccessPermissions = GENERIC_ALL;
            entries[i].grfAccessMode = GRANT_ACCESS;
            entries[i].grfInheritance = 0;
            entries[i].Trustee.pMultipleTrustee = IntPtr.Zero;
            entries[i].Trustee.MultipleTrusteeOperation = 0;
            entries[i].Trustee.TrusteeForm = TRUSTEE_IS_SID;
            entries[i].Trustee.TrusteeType = 0;
            entries[i].Trustee.ptstrName = sids[i];
        }
        IntPtr acl;
        var built = SetEntriesInAcl((uint)entries.Length, entries, IntPtr.Zero, out acl);
        if (built != 0 || acl == IntPtr.Zero)
        {
            error = "SetEntriesInAclW failed: " + built.ToString();
            return false;
        }
        var info = Marshal.AllocHGlobal(IntPtr.Size);
        try
        {
            Marshal.WriteIntPtr(info, acl);
            if (!SetTokenInformation(token, TokenDefaultDacl, info, IntPtr.Size))
            {
                error = "SetTokenInformation TokenDefaultDacl failed: " + Marshal.GetLastWin32Error().ToString();
                return false;
            }
            return true;
        }
        finally
        {
            Marshal.FreeHGlobal(info);
            LocalFree(acl);
        }
    }

    static bool TryEnablePrivilege(IntPtr token, string name, out string error)
    {
        error = null;
        Luid luid;
        if (!LookupPrivilegeValue(null, name, out luid))
        {
            error = "LookupPrivilegeValue failed: " + Marshal.GetLastWin32Error().ToString();
            return false;
        }
        var privileges = new TokenPrivileges();
        privileges.PrivilegeCount = 1;
        privileges.Privileges.Luid = luid;
        privileges.Privileges.Attributes = SE_PRIVILEGE_ENABLED;
        if (!AdjustTokenPrivileges(token, false, ref privileges, 0, IntPtr.Zero, IntPtr.Zero))
        {
            error = "AdjustTokenPrivileges failed: " + Marshal.GetLastWin32Error().ToString();
            return false;
        }
        var win32 = Marshal.GetLastWin32Error();
        if (win32 != 0)
        {
            error = "AdjustTokenPrivileges error " + win32.ToString();
            return false;
        }
        return true;
    }

    static bool ConfigureJob(IntPtr job, out string error)
    {
        error = null;
        var extended = Marshal.AllocHGlobal(144);
        var ui = Marshal.AllocHGlobal(4);
        try
        {
            for (var i = 0; i < 144; i++) Marshal.WriteByte(extended, i, 0);
            Marshal.WriteInt32(extended, 16, unchecked((int)JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE));
            if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, extended, 144))
            {
                error = "SetInformationJobObject extended limits failed: " + new Win32Exception(Marshal.GetLastWin32Error()).Message;
                return false;
            }
            Marshal.WriteInt32(ui, 0, 0x1 | 0x2 | 0x4 | 0x8 | 0x10 | 0x20 | 0x40 | 0x80);
            if (!SetInformationJobObject(job, JobObjectBasicUIRestrictions, ui, 4))
            {
                error = "SetInformationJobObject UI restrictions failed: " + new Win32Exception(Marshal.GetLastWin32Error()).Message;
                return false;
            }
            return true;
        }
        finally
        {
            Marshal.FreeHGlobal(extended);
            Marshal.FreeHGlobal(ui);
        }
    }

    static IntPtr BuildEnvironment(List<string> pairs)
    {
        var builder = new StringBuilder();
        foreach (var pair in pairs)
        {
            builder.Append(pair);
            builder.Append('\0');
        }
        builder.Append('\0');
        var bytes = Encoding.Unicode.GetBytes(builder.ToString());
        var memory = Marshal.AllocHGlobal(bytes.Length);
        Marshal.Copy(bytes, 0, memory, bytes.Length);
        return memory;
    }

    static void GrantDirectory(string path, IdentityReference sid)
    {
        var info = new DirectoryInfo(path);
        var security = info.GetAccessControl();
        security.AddAccessRule(new FileSystemAccessRule(
            sid,
            FileSystemRights.Modify | FileSystemRights.Synchronize,
            InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
            PropagationFlags.None,
            AccessControlType.Allow));
        info.SetAccessControl(security);
    }

    static void DenyDirectory(string path, IdentityReference sid)
    {
        var info = new DirectoryInfo(path);
        var security = info.GetAccessControl();
        security.AddAccessRule(new FileSystemAccessRule(
            sid,
            FileSystemRights.Write | FileSystemRights.Delete | FileSystemRights.DeleteSubdirectoriesAndFiles | FileSystemRights.ChangePermissions | FileSystemRights.TakeOwnership,
            InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
            PropagationFlags.None,
            AccessControlType.Deny));
        info.SetAccessControl(security);
    }

    static void DenyFile(string path, IdentityReference sid)
    {
        var info = new FileInfo(path);
        var security = info.GetAccessControl();
        security.AddAccessRule(new FileSystemAccessRule(
            sid,
            FileSystemRights.Write | FileSystemRights.Delete | FileSystemRights.ChangePermissions,
            AccessControlType.Deny));
        info.SetAccessControl(security);
    }

    static void Purge(string path, IdentityReference sid)
    {
        if (Directory.Exists(path))
        {
            var info = new DirectoryInfo(path);
            var security = info.GetAccessControl();
            security.PurgeAccessRules(sid);
            info.SetAccessControl(security);
            return;
        }
        if (File.Exists(path))
        {
            var info = new FileInfo(path);
            var security = info.GetAccessControl();
            security.PurgeAccessRules(sid);
            info.SetAccessControl(security);
        }
    }

    static List<string> StringList(Dictionary<string, object> data, string key)
    {
        var list = new List<string>();
        if (!data.ContainsKey(key) || data[key] == null) return list;
        var array = data[key] as ArrayList;
        if (array == null) throw new InvalidOperationException(key + " must be an array");
        foreach (var item in array) list.Add(Convert.ToString(item));
        return list;
    }

    static string Ok(object id, Dictionary<string, object> fields)
    {
        fields["ok"] = true;
        if (id != null) fields["id"] = Convert.ToString(id);
        var serializer = new JavaScriptSerializer();
        serializer.MaxJsonLength = int.MaxValue;
        return serializer.Serialize(fields);
    }

    static string Fail(object id, string reason, int win32, string detail)
    {
        var fields = new Dictionary<string, object>();
        fields["ok"] = false;
        if (id != null) fields["id"] = Convert.ToString(id);
        fields["reason"] = reason ?? "failed";
        fields["win32"] = win32;
        fields["detail"] = detail ?? "";
        var serializer = new JavaScriptSerializer();
        serializer.MaxJsonLength = int.MaxValue;
        return serializer.Serialize(fields);
    }
}
