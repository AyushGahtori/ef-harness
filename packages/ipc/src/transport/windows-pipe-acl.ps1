$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$code = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class EfPipeSecurity {
  const int ProcessHandleInformation = 51;
  const int ObjectNameInformation = 1;
  const int ObjectTypeInformation = 2;
  const uint PROCESS_DUP_HANDLE = 0x0040;
  const uint PROCESS_QUERY_INFORMATION = 0x0400;
  const uint DUPLICATE_SAME_ACCESS = 0x2;
  [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr p, int c, IntPtr b, int l, out int r);
  [DllImport("ntdll.dll")] static extern int NtQueryObject(IntPtr h, int c, IntPtr b, int l, out int r);
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint a, bool i, int pid);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool DuplicateHandle(IntPtr a, IntPtr b, IntPtr c, out IntPtr d, uint e, bool f, uint g);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool CloseHandle(IntPtr h);
  [DllImport("advapi32.dll", SetLastError=true)] static extern uint GetSecurityInfo(IntPtr h, int t, int i, out IntPtr o, out IntPtr g, out IntPtr d, out IntPtr s, out IntPtr sd);
  [DllImport("advapi32.dll", SetLastError=true)] static extern uint SetSecurityInfo(IntPtr h, int t, int i, IntPtr o, IntPtr g, IntPtr d, IntPtr s);
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string s, uint r, out IntPtr sd, out uint n);
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool ConvertSecurityDescriptorToStringSecurityDescriptor(IntPtr sd, uint r, uint i, out IntPtr s, out uint n);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool GetSecurityDescriptorDacl(IntPtr sd, out bool p, out IntPtr d, out bool def);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr h);

  static string QueryString(IntPtr handle, int cls) {
    int len = 512;
    IntPtr buf = Marshal.AllocHGlobal(len);
    try {
      int ret;
      int status = NtQueryObject(handle, cls, buf, len, out ret);
      if (status == unchecked((int)0xC0000004)) {
        Marshal.FreeHGlobal(buf);
        len = Math.Max(ret + 64, 1024);
        buf = Marshal.AllocHGlobal(len);
        status = NtQueryObject(handle, cls, buf, len, out ret);
      }
      if (status != 0) return null;
      int nameLen = Marshal.ReadInt16(buf);
      if (nameLen <= 0) return "";
      IntPtr chars = Marshal.ReadIntPtr(buf, 8);
      if (chars == IntPtr.Zero) return "";
      return Marshal.PtrToStringUni(chars, nameLen / 2);
    } finally {
      Marshal.FreeHGlobal(buf);
    }
  }

  static string SddlOf(IntPtr handle) {
    IntPtr owner, group, dacl, sacl, sd;
    uint err = GetSecurityInfo(handle, 6, 4, out owner, out group, out dacl, out sacl, out sd);
    if (err != 0) return "SEC" + err;
    IntPtr text; uint len;
    if (!ConvertSecurityDescriptorToStringSecurityDescriptor(sd, 1, 4, out text, out len)) {
      LocalFree(sd);
      return "CONV" + Marshal.GetLastWin32Error();
    }
    string value = Marshal.PtrToStringUni(text);
    LocalFree(text);
    LocalFree(sd);
    return value;
  }

  static int Apply(IntPtr handle, string sddl) {
    IntPtr sd; uint size;
    if (!ConvertStringSecurityDescriptorToSecurityDescriptor(sddl, 1, out sd, out size)) return Marshal.GetLastWin32Error();
    bool present; IntPtr dacl; bool def;
    if (!GetSecurityDescriptorDacl(sd, out present, out dacl, out def)) {
      int error = Marshal.GetLastWin32Error();
      LocalFree(sd);
      return error;
    }
    uint set = SetSecurityInfo(handle, 6, unchecked((int)0x80000004), IntPtr.Zero, IntPtr.Zero, dacl, IntPtr.Zero);
    LocalFree(sd);
    return (int)set;
  }

  public static string Fix(int pid, string leaf, string sid) {
    string sddl = "D:P(A;;FA;;;SY)(A;;FA;;;" + sid + ")";
    return Visit(pid, leaf, sddl, true);
  }

  public static string Read(int pid, string leaf) {
    return Visit(pid, leaf, "", false);
  }

  static string Visit(int pid, string leaf, string sddl, bool apply) {
    IntPtr proc = OpenProcess(PROCESS_DUP_HANDLE | PROCESS_QUERY_INFORMATION, false, pid);
    if (proc == IntPtr.Zero) return "ERR open " + Marshal.GetLastWin32Error();
    int len = 1 << 16;
    IntPtr buf = Marshal.AllocHGlobal(len);
    int ret;
    int status = NtQueryInformationProcess(proc, ProcessHandleInformation, buf, len, out ret);
    while (status == unchecked((int)0xC0000004)) {
      Marshal.FreeHGlobal(buf);
      len = Math.Max(ret + 4096, len * 2);
      buf = Marshal.AllocHGlobal(len);
      status = NtQueryInformationProcess(proc, ProcessHandleInformation, buf, len, out ret);
    }
    if (status != 0) {
      Marshal.FreeHGlobal(buf);
      CloseHandle(proc);
      return "ERR query " + status.ToString("X");
    }
    long count = Marshal.ReadInt64(buf);
    int entry = 40;
    IntPtr cursor = buf + 16;
    var names = new StringBuilder();
    int matched = 0;
    int appliedCount = 0;
    string needle = "\\" + leaf;
    for (long i = 0; i < count; i++) {
      IntPtr handleValue = Marshal.ReadIntPtr(cursor);
      cursor += entry;
      IntPtr dup;
      if (!DuplicateHandle(proc, handleValue, GetCurrentProcess(), out dup, 0, false, DUPLICATE_SAME_ACCESS)) continue;
      string type = QueryString(dup, ObjectTypeInformation);
      if (type != "File") { CloseHandle(dup); continue; }
      string name = QueryString(dup, ObjectNameInformation);
      if (name != null && name.EndsWith(needle, StringComparison.OrdinalIgnoreCase)) {
        matched++;
        if (apply) {
          int applied = Apply(dup, sddl);
          if (applied == 0) appliedCount++;
        }
        if (names.Length > 0) names.Append("\n");
        names.Append(SddlOf(dup));
      }
      CloseHandle(dup);
    }
    Marshal.FreeHGlobal(buf);
    CloseHandle(proc);
    if (apply && appliedCount == 0) return "ERR apply 0";
    return "OK " + (apply ? appliedCount : matched) + "\n" + names.ToString();
  }
}
'@
Add-Type -TypeDefinition $code
$nodePid = [int]$args[0]
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
function Emit([string]$line) {
  [Console]::Out.WriteLine($line)
  [Console]::Out.Flush()
}
function Decode([string]$b64) {
  return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64))
}
function Lock-TokenFile([string]$file, [string]$userSid) {
  $acl = Get-Acl -LiteralPath $file
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRule($rule) }
  $identity = New-Object System.Security.Principal.SecurityIdentifier($userSid)
  $grant = New-Object System.Security.AccessControl.FileSystemAccessRule($identity, "FullControl", "Allow")
  $acl.AddAccessRule($grant)
  Set-Acl -LiteralPath $file -AclObject $acl
}
Emit "READY $sid"
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line -or $line -eq "QUIT") { break }
  try {
    if ($line -eq "SID") { Emit "SID $sid"; continue }
    if ($line.StartsWith("FIX ")) {
      $leaf = Decode $line.Substring(4)
      $raw = [EfPipeSecurity]::Fix($nodePid, $leaf, $sid)
      if ($raw.StartsWith("ERR")) { Emit $raw; continue }
      $parts = $raw.Split([char]10, 2)
      Emit $parts[0]
      continue
    }
    if ($line.StartsWith("SDDL ")) {
      $leaf = Decode $line.Substring(5)
      $raw = [EfPipeSecurity]::Read($nodePid, $leaf)
      if ($raw.StartsWith("ERR")) { Emit $raw; continue }
      $parts = $raw.Split([char]10, 2)
      $body = if ($parts.Length -gt 1) { $parts[1] } else { "" }
      Emit ("SDDL " + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($body)))
      continue
    }
    if ($line.StartsWith("LOCK ")) {
      Lock-TokenFile (Decode $line.Substring(5)) $sid
      Emit "OK lock"
      continue
    }
    if ($line.StartsWith("FILE ")) {
      $file = Decode $line.Substring(5)
      $acl = Get-Acl -LiteralPath $file
      $text = $acl.GetSecurityDescriptorSddlForm("Access")
      Emit ("FILE " + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($text)))
      continue
    }
    Emit "ERR unknown command"
  } catch {
    $message = $_.Exception.Message -replace "[\r\n]+", " "
    Emit "ERR $message"
  }
}
