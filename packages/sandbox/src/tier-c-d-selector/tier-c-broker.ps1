param(
  [Parameter(Mandatory = $true)][string]$RequestPath,
  [Parameter(Mandatory = $true)][string]$ResultPath
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-Result([string]$Json) {
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($ResultPath, $Json, $utf8)
}

try {
  Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;

public static class TierCBroker {
  const uint WRITE_RESTRICTED = 0x8;
  const uint DISABLE_MAX_PRIVILEGE = 0x1;
  const uint LUA_TOKEN = 0x4;
  const uint TOKEN_ALL = 0xF01FF;
  const uint CREATE_NO_WINDOW = 0x08000000;
  const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
  const uint CREATE_SUSPENDED = 0x00000004;
  const uint SE_GROUP_LOGON_ID = 0xC0000000;
  const uint GENERIC_ALL = 0x10000000;
  const uint WAIT_TIMEOUT = 258;
  const int TokenGroups = 2;
  const int TokenDefaultDacl = 6;
  const int WinWorldSid = 1;
  const int SECURITY_MAX_SID_SIZE = 68;

  [StructLayout(LayoutKind.Sequential)]
  public struct SID_AND_ATTRIBUTES {
    public IntPtr Sid;
    public uint Attributes;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct TOKEN_DEFAULT_DACL {
    public IntPtr DefaultDacl;
  }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct STARTUPINFO {
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
  public struct PROCESS_INFORMATION {
    public IntPtr hProcess;
    public IntPtr hThread;
    public int dwProcessId;
    public int dwThreadId;
  }

  [DllImport("kernel32.dll")]
  static extern IntPtr GetCurrentProcess();

  [DllImport("kernel32.dll")]
  static extern void Sleep(uint ms);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern uint ResumeThread(IntPtr hThread);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool TerminateProcess(IntPtr hProcess, uint exitCode);

  [DllImport("advapi32.dll", SetLastError = true)]
  static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);

  [DllImport("advapi32.dll", SetLastError = true)]
  static extern bool GetTokenInformation(IntPtr token, int cls, IntPtr buf, int len, out int needed);

  [DllImport("advapi32.dll", SetLastError = true)]
  static extern bool SetTokenInformation(IntPtr token, int cls, ref TOKEN_DEFAULT_DACL info, int len);

  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool ConvertStringSidToSid(string text, out IntPtr sid);

  [DllImport("advapi32.dll", SetLastError = true)]
  static extern bool CreateWellKnownSid(int type, IntPtr domain, IntPtr sid, ref int size);

  [DllImport("advapi32.dll", SetLastError = true)]
  static extern int GetLengthSid(IntPtr sid);

  [DllImport("advapi32.dll", SetLastError = true)]
  static extern bool CopySid(int len, IntPtr dest, IntPtr src);

  [DllImport("advapi32.dll", SetLastError = true)]
  static extern bool CreateRestrictedToken(
    IntPtr existing,
    uint flags,
    uint disableCount,
    IntPtr disableList,
    uint deleteCount,
    IntPtr deleteList,
    uint restrictCount,
    SID_AND_ATTRIBUTES[] restrictList,
    out IntPtr restricted);

  [DllImport("advapi32.dll", SetLastError = true)]
  static extern bool InitializeAcl(IntPtr acl, int len, int revision);

  [DllImport("advapi32.dll", SetLastError = true)]
  static extern bool AddAccessAllowedAce(IntPtr acl, int revision, uint mask, IntPtr sid);

  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool CreateProcessAsUser(
    IntPtr token,
    string application,
    string commandLine,
    IntPtr processAttributes,
    IntPtr threadAttributes,
    bool inherit,
    uint flags,
    IntPtr env,
    string cwd,
    ref STARTUPINFO startup,
    out PROCESS_INFORMATION processInformation);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern uint WaitForSingleObject(IntPtr handle, uint ms);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool GetExitCodeProcess(IntPtr process, out uint code);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool CloseHandle(IntPtr handle);

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
  static extern uint GetDriveType(string root);

  static string Esc(string value) {
    if (value == null) return "";
    return value.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n");
  }

  static string Error(string message) {
    return "{\"ok\":false,\"error\":\"" + Esc(message) + "\"}";
  }

  static IntPtr CopyOf(IntPtr sid) {
    int len = GetLengthSid(sid);
    IntPtr dest = Marshal.AllocHGlobal(len);
    if (!CopySid(len, dest, sid)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    return dest;
  }

  static IntPtr LogonSid(IntPtr token) {
    int needed;
    GetTokenInformation(token, TokenGroups, IntPtr.Zero, 0, out needed);
    IntPtr buf = Marshal.AllocHGlobal(needed);
    if (!GetTokenInformation(token, TokenGroups, buf, needed, out needed)) {
      throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    }
    int count = Marshal.ReadInt32(buf);
    int size = Marshal.SizeOf(typeof(SID_AND_ATTRIBUTES));
    int start = (4 + (IntPtr.Size - 1)) & ~(IntPtr.Size - 1);
    for (int i = 0; i < count; i++) {
      IntPtr entry = new IntPtr(buf.ToInt64() + start + (i * size));
      SID_AND_ATTRIBUTES group = (SID_AND_ATTRIBUTES)Marshal.PtrToStructure(entry, typeof(SID_AND_ATTRIBUTES));
      if ((group.Attributes & SE_GROUP_LOGON_ID) == SE_GROUP_LOGON_ID) {
        IntPtr copy = CopyOf(group.Sid);
        Marshal.FreeHGlobal(buf);
        return copy;
      }
    }
    Marshal.FreeHGlobal(buf);
    throw new Exception("The process token has no logon SID.");
  }

  static IntPtr EveryoneSid() {
    int size = SECURITY_MAX_SID_SIZE;
    IntPtr sid = Marshal.AllocHGlobal(size);
    if (!CreateWellKnownSid(WinWorldSid, IntPtr.Zero, sid, ref size)) {
      throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    }
    return sid;
  }

  static void SetDefaultDacl(IntPtr token, IntPtr logon, IntPtr capability) {
    int len = 256 + (2 * SECURITY_MAX_SID_SIZE);
    IntPtr acl = Marshal.AllocHGlobal(len);
    if (!InitializeAcl(acl, len, 2)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    if (!AddAccessAllowedAce(acl, 2, GENERIC_ALL, logon)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    if (!AddAccessAllowedAce(acl, 2, GENERIC_ALL, capability)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    TOKEN_DEFAULT_DACL dacl = new TOKEN_DEFAULT_DACL();
    dacl.DefaultDacl = acl;
    if (!SetTokenInformation(token, TokenDefaultDacl, ref dacl, Marshal.SizeOf(typeof(TOKEN_DEFAULT_DACL)))) {
      throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "SetTokenInformation TokenDefaultDacl");
    }
  }

  static void Grant(string dir, SecurityIdentifier sid) {
    Directory.CreateDirectory(dir);
    DirectoryInfo info = new DirectoryInfo(dir);
    DirectorySecurity security = info.GetAccessControl();
    FileSystemAccessRule rule = new FileSystemAccessRule(
      sid,
      FileSystemRights.Modify,
      InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
      PropagationFlags.None,
      AccessControlType.Allow);
    security.RemoveAccessRuleAll(rule);
    security.AddAccessRule(rule);
    info.SetAccessControl(security);
  }

  static void DenyWrite(string dir, SecurityIdentifier sid) {
    Directory.CreateDirectory(dir);
    DirectoryInfo info = new DirectoryInfo(dir);
    DirectorySecurity security = info.GetAccessControl();
    FileSystemRights rights = FileSystemRights.Write
      | FileSystemRights.Delete
      | FileSystemRights.DeleteSubdirectoriesAndFiles
      | FileSystemRights.Modify
      | FileSystemRights.ChangePermissions
      | FileSystemRights.TakeOwnership;
    FileSystemAccessRule rule = new FileSystemAccessRule(
      sid,
      rights,
      InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
      PropagationFlags.None,
      AccessControlType.Deny);
    security.RemoveAccessRuleAll(rule);
    security.AddAccessRule(rule);
    info.SetAccessControl(security);
  }

  static IntPtr EnvBlock(string envText) {
    string normalized = envText == null ? "" : envText.Replace("\r\n", "\n").Replace("\n", "\0");
    if (!normalized.EndsWith("\0")) normalized = normalized + "\0";
    normalized = normalized + "\0";
    byte[] bytes = Encoding.Unicode.GetBytes(normalized);
    IntPtr mem = Marshal.AllocHGlobal(bytes.Length);
    Marshal.Copy(bytes, 0, mem, bytes.Length);
    return mem;
  }

  public static string Prepare(string worktree, string tempDir, string capabilitySid) {
    IntPtr cap;
    if (!ConvertStringSidToSid(capabilitySid, out cap)) return Error("ConvertStringSidToSid failed: " + Marshal.GetLastWin32Error());
    SecurityIdentifier sid = new SecurityIdentifier(cap);
    Grant(worktree, sid);
    Grant(tempDir, sid);
    DenyWrite(Path.Combine(worktree, ".git"), sid);
    DenyWrite(Path.Combine(worktree, "node_modules"), sid);
    return "{\"ok\":true,\"capabilitySid\":\"" + Esc(capabilitySid) + "\"}";
  }

  public static string Classify(string target) {
    if (target.StartsWith("\\\\")) return "{\"ok\":true,\"drive\":\"unc\"}";
    string root = Path.GetPathRoot(target);
    if (root == null || root.Length == 0) return "{\"ok\":true,\"drive\":\"unknown\"}";
    uint kind = GetDriveType(root);
    string name = "unknown";
    if (kind == 2) name = "removable";
    else if (kind == 3) name = "fixed";
    else if (kind == 4) name = "remote";
    else if (kind == 5) name = "cdrom";
    else if (kind == 6) name = "ramdisk";
    return "{\"ok\":true,\"drive\":\"" + name + "\"}";
  }

  public static string Launch(
    string capabilitySid,
    bool suspend,
    string pidFile,
    string controlFile,
    string executable,
    string commandLine,
    string cwd,
    string envText,
    int timeoutMs) {
    IntPtr cap;
    if (!ConvertStringSidToSid(capabilitySid, out cap)) return Error("ConvertStringSidToSid failed: " + Marshal.GetLastWin32Error());
    IntPtr processToken;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_ALL, out processToken)) {
      return Error("OpenProcessToken failed: " + Marshal.GetLastWin32Error());
    }
    IntPtr logon = LogonSid(processToken);
    IntPtr everyone = EveryoneSid();
    SID_AND_ATTRIBUTES[] restrict = new SID_AND_ATTRIBUTES[3];
    restrict[0].Sid = cap;
    restrict[0].Attributes = 0;
    restrict[1].Sid = logon;
    restrict[1].Attributes = 0;
    restrict[2].Sid = everyone;
    restrict[2].Attributes = 0;
    IntPtr restricted;
    uint flags = DISABLE_MAX_PRIVILEGE | LUA_TOKEN | WRITE_RESTRICTED;
    if (!CreateRestrictedToken(processToken, flags, 0, IntPtr.Zero, 0, IntPtr.Zero, 3, restrict, out restricted)) {
      return Error("CreateRestrictedToken failed: " + Marshal.GetLastWin32Error());
    }
    SetDefaultDacl(restricted, logon, cap);
    IntPtr env = EnvBlock(envText);
    STARTUPINFO si = new STARTUPINFO();
    si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
    si.lpDesktop = "WinSta0\\Default";
    PROCESS_INFORMATION pi;
    uint createFlags = CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW;
    if (suspend) createFlags = createFlags | CREATE_SUSPENDED;
    bool created = CreateProcessAsUser(restricted, executable, commandLine, IntPtr.Zero, IntPtr.Zero, false, createFlags, env, cwd, ref si, out pi);
    int createError = Marshal.GetLastWin32Error();
    if (!created) {
      CloseHandle(processToken);
      CloseHandle(restricted);
      return Error("CreateProcessAsUser failed: " + createError);
    }
    if (suspend) {
      File.WriteAllText(pidFile, pi.dwProcessId.ToString());
      int waited = 0;
      bool resumed = false;
      while (waited < 30000) {
        if (File.Exists(controlFile)) {
          string directive = File.ReadAllText(controlFile).Trim();
          if (directive == "resume") {
            ResumeThread(pi.hThread);
            resumed = true;
          } else {
            TerminateProcess(pi.hProcess, 1);
            CloseHandle(pi.hThread);
            CloseHandle(pi.hProcess);
            CloseHandle(processToken);
            CloseHandle(restricted);
            return "{\"ok\":false,\"error\":\"terminated before resume\",\"pid\":" + pi.dwProcessId + "}";
          }
          break;
        }
        Sleep(50);
        waited = waited + 50;
      }
      if (!resumed) {
        TerminateProcess(pi.hProcess, 1);
        CloseHandle(pi.hThread);
        CloseHandle(pi.hProcess);
        CloseHandle(processToken);
        CloseHandle(restricted);
        return "{\"ok\":false,\"error\":\"suspend timeout\",\"pid\":" + pi.dwProcessId + "}";
      }
    }
    uint wait = WaitForSingleObject(pi.hProcess, (uint)timeoutMs);
    bool timedOut = wait == WAIT_TIMEOUT;
    if (timedOut) TerminateProcess(pi.hProcess, 1);
    uint code;
    GetExitCodeProcess(pi.hProcess, out code);
    int pid = pi.dwProcessId;
    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);
    CloseHandle(processToken);
    CloseHandle(restricted);
    return "{\"ok\":true,\"exitCode\":" + code + ",\"pid\":" + pid + ",\"timedOut\":" + (timedOut ? "true" : "false") + "}";
  }
}
"@

  $req = Get-Content -Raw -Path $RequestPath | ConvertFrom-Json
  $action = [string]$req.action
  if ($action -eq "prepare") {
    Write-Result ([TierCBroker]::Prepare([string]$req.worktree, [string]$req.temp, [string]$req.capabilitySid))
    exit 0
  }
  if ($action -eq "classify") {
    Write-Result ([TierCBroker]::Classify([string]$req.path))
    exit 0
  }
  if ($action -eq "launch") {
    $envText = ""
    if ($req.envB64) {
      $envText = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String([string]$req.envB64))
    }
    $suspend = $false
    if ($req.suspend -eq $true) { $suspend = $true }
    $timeout = 60000
    if ($req.timeoutMs) { $timeout = [int]$req.timeoutMs }
    Write-Result ([TierCBroker]::Launch(
      [string]$req.capabilitySid,
      $suspend,
      [string]$req.pidFile,
      [string]$req.controlFile,
      [string]$req.executable,
      [string]$req.commandLine,
      [string]$req.cwd,
      $envText,
      $timeout))
    exit 0
  }
  Write-Result '{"ok":false,"error":"unknown action"}'
  exit 1
}
catch {
  $message = $_.Exception.Message
  if (-not $message) { $message = "tier c broker failed" }
  $escaped = $message.Replace('\', '\\').Replace('"', '\"').Replace("`r", '').Replace("`n", ' ')
  Write-Result ('{"ok":false,"error":"' + $escaped + '"}')
  exit 1
}
