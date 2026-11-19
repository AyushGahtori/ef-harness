param(
  [Parameter(Mandatory = $true)][string]$Action,
  [int]$TargetPid = 0,
  [string]$MemoryLimitBytes = "0",
  [string]$VolumePath = ""
)

$ErrorActionPreference = "Stop"
[System.Threading.Thread]::CurrentThread.CurrentCulture = [System.Globalization.CultureInfo]::InvariantCulture

function Emit([hashtable]$Fields) {
  $parts = @()
  foreach ($key in $Fields.Keys) {
    $value = $Fields[$key]
    if ($null -eq $value) {
      $encoded = "null"
    } elseif ($value -is [bool]) {
      $encoded = $(if ($value) { "true" } else { "false" })
    } elseif ($value -is [string]) {
      $escaped = $value.Replace("\", "\\").Replace('"', '\"').Replace("`r", "").Replace("`n", " ")
      $encoded = '"' + $escaped + '"'
    } else {
      $encoded = [string]$value
    }
    $parts += '"' + $key + '":' + $encoded
  }
  [Console]::Out.WriteLine("{" + ($parts -join ",") + "}")
  [Console]::Out.Flush()
}

if (-not ("EfCapacityNative" -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class EfCapacityNative {
  [StructLayout(LayoutKind.Sequential)]
  public struct MEMORYSTATUSEX {
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

  [StructLayout(LayoutKind.Explicit, Size = 64)]
  public struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
    [FieldOffset(0)] public long PerProcessUserTimeLimit;
    [FieldOffset(8)] public long PerJobUserTimeLimit;
    [FieldOffset(16)] public uint LimitFlags;
    [FieldOffset(24)] public UIntPtr MinimumWorkingSetSize;
    [FieldOffset(32)] public UIntPtr MaximumWorkingSetSize;
    [FieldOffset(40)] public uint ActiveProcessLimit;
    [FieldOffset(48)] public UIntPtr Affinity;
    [FieldOffset(56)] public uint PriorityClass;
    [FieldOffset(60)] public uint SchedulingClass;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct IO_COUNTERS {
    public ulong ReadOperationCount;
    public ulong WriteOperationCount;
    public ulong OtherOperationCount;
    public ulong ReadTransferCount;
    public ulong WriteTransferCount;
    public ulong OtherTransferCount;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
    public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
    public IO_COUNTERS IoInfo;
    public UIntPtr ProcessMemoryLimit;
    public UIntPtr JobMemoryLimit;
    public UIntPtr PeakProcessMemoryUsed;
    public UIntPtr PeakJobMemoryUsed;
  }

  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool GlobalMemoryStatusEx(ref MEMORYSTATUSEX lpBuffer);

  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool GetSystemTimes(out long idle, out long kernel, out long user);

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern IntPtr CreateJobObject(IntPtr attributes, string name);

  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);

  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool QueryInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length, IntPtr returnLength);

  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern IntPtr OpenProcess(uint access, bool inherit, uint processId);

  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool CloseHandle(IntPtr handle);

  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool TerminateJobObject(IntPtr job, uint exitCode);
}
"@
}

function Get-MemoryStatus {
  $status = New-Object EfCapacityNative+MEMORYSTATUSEX
  $status.dwLength = [uint32][Runtime.InteropServices.Marshal]::SizeOf($status)
  $ok = [EfCapacityNative]::GlobalMemoryStatusEx([ref]$status)
  if (-not $ok) {
    throw "GlobalMemoryStatusEx failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  }
  return $status
}

function Get-CpuPercent {
  $idle1 = [int64]0
  $kernel1 = [int64]0
  $user1 = [int64]0
  $idle2 = [int64]0
  $kernel2 = [int64]0
  $user2 = [int64]0
  [void][EfCapacityNative]::GetSystemTimes([ref]$idle1, [ref]$kernel1, [ref]$user1)
  Start-Sleep -Milliseconds 200
  [void][EfCapacityNative]::GetSystemTimes([ref]$idle2, [ref]$kernel2, [ref]$user2)
  $idle = $idle2 - $idle1
  $total = ($kernel2 - $kernel1) + ($user2 - $user1)
  if ($total -le 0) { return 0 }
  $busy = $total - $idle
  if ($busy -lt 0) { $busy = 0 }
  return [math]::Round((100.0 * $busy / $total), 2)
}

function Get-CounterSnapshot {
  $memory = Get-CimInstance -ClassName Win32_PerfFormattedData_PerfOS_Memory
  $disk = Get-CimInstance -ClassName Win32_PerfFormattedData_PerfDisk_PhysicalDisk -Filter "Name='_Total'"
  $process = Get-CimInstance -ClassName Win32_PerfFormattedData_PerfProc_Process -Filter "Name='_Total'"
  $active = $null
  if ($null -ne $disk.PercentIdleTime) {
    $active = [math]::Max(0, [math]::Min(100, 100 - [double]$disk.PercentIdleTime))
  }
  return @{
    pageReads = [double]$memory.PageReadsPersec
    pageFaults = [double]$memory.PageFaultsPersec
    committedCounter = [int64]$memory.CommittedBytes
    diskActive = $active
    diskQueue = [double]$disk.CurrentDiskQueueLength
    diskTime = [double]$disk.PercentDiskTime
    workingSet = [int64]$process.WorkingSet
  }
}

function Get-DefenderCpu {
  $proc = Get-Process -Name "MsMpEng" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -eq $proc) {
    return @{ found = $false; cpu = 0; workingSet = 0 }
  }
  $cores = [Math]::Max(1, [Environment]::ProcessorCount)
  $startCpu = $proc.TotalProcessorTime.TotalMilliseconds
  $start = [DateTime]::UtcNow
  Start-Sleep -Milliseconds 200
  $proc.Refresh()
  $elapsed = ([DateTime]::UtcNow - $start).TotalMilliseconds
  $delta = $proc.TotalProcessorTime.TotalMilliseconds - $startCpu
  $percent = 0
  if ($elapsed -gt 0) {
    $percent = [math]::Round((100.0 * $delta) / ($elapsed * $cores), 2)
  }
  return @{ found = $true; cpu = $percent; workingSet = [int64]$proc.WorkingSet64 }
}

$script:VolumeCache = $null
$script:GpuCache = $null
$script:OsCache = $null

function Get-VolumeInfo([string]$PathValue) {
  if ($null -ne $script:VolumeCache) { return $script:VolumeCache }
  $full = if ([string]::IsNullOrWhiteSpace($PathValue)) { (Get-Location).Path } else { $PathValue }
  $root = [System.IO.Path]::GetPathRoot($full)
  if ([string]::IsNullOrWhiteSpace($root)) { $root = $full }
  $drive = $root.TrimEnd("\")
  $disk = Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DeviceID='$drive'"
  $fileSystem = [string]$disk.FileSystem
  $fsutilText = ""
  $fsutilError = ""
  $tmpOut = Join-Path ([System.IO.Path]::GetTempPath()) ("ef-devdrv-" + [guid]::NewGuid().ToString("n") + ".txt")
  $tmpErr = Join-Path ([System.IO.Path]::GetTempPath()) ("ef-devdrv-" + [guid]::NewGuid().ToString("n") + ".err")
  try {
    $fsutil = Start-Process -FilePath "fsutil.exe" -ArgumentList @("devdrv", "query", $drive) -WindowStyle Hidden -PassThru -RedirectStandardOutput $tmpOut -RedirectStandardError $tmpErr
    if (-not $fsutil.WaitForExit(2000)) {
      try { Stop-Process -Id $fsutil.Id -Force -ErrorAction SilentlyContinue } catch { }
      $fsutilError = "timeout"
    } else {
      if (Test-Path $tmpOut) { $fsutilText = (Get-Content -Raw -ErrorAction SilentlyContinue $tmpOut) }
      if (Test-Path $tmpErr) { $fsutilError = (Get-Content -Raw -ErrorAction SilentlyContinue $tmpErr) }
    }
  } catch {
    $fsutilError = $_.Exception.Message
  } finally {
    Remove-Item -LiteralPath $tmpOut, $tmpErr -Force -ErrorAction SilentlyContinue
  }
  $combined = (($fsutilText + " " + $fsutilError).ToLowerInvariant())
  $devDrive = "not_available_on_host"
  if ($combined -match "this is a dev drive" -or $combined -match "is a trusted dev drive" -or ($fileSystem -eq "ReFS" -and $combined -match "dev drive" -and $combined -notmatch "not a dev drive" -and $combined -notmatch "access is denied")) {
    $devDrive = "dev_drive"
  }
  $script:VolumeCache = @{
    fileSystem = $fileSystem
    devDrive = $devDrive
    fsutil = ($fsutilText + " " + $fsutilError).Trim()
    drive = $drive
  }
  return $script:VolumeCache
}

function Get-GpuName {
  if ($null -ne $script:GpuCache) { return $script:GpuCache }
  $names = @(Get-CimInstance -ClassName Win32_VideoController | ForEach-Object { [string]$_.Name } | Where-Object { $_ })
  $script:GpuCache = $(if ($names.Count -eq 0) { "unknown" } else { $names -join "; " })
  return $script:GpuCache
}

function Get-OsBuild {
  if ($null -ne $script:OsCache) { return $script:OsCache }
  $current = Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion"
  $script:OsCache = @{
    build = [string]$current.CurrentBuild
    ubr = [string]$current.UBR
    product = [string]$current.ProductName
  }
  return $script:OsCache
}

function Emit-Sample {
  $memory = Get-MemoryStatus
  $cpu = Get-CpuPercent
  $counters = Get-CounterSnapshot
  $defender = Get-DefenderCpu
  $volume = Get-VolumeInfo $VolumePath
  $gpu = Get-GpuName
  $os = Get-OsBuild
  $commit = [int64]$memory.ullTotalPageFile - [int64]$memory.ullAvailPageFile
  $ratio = 0
  if ([int64]$memory.ullTotalPageFile -gt 0) {
    $ratio = [math]::Round($commit / [double]$memory.ullTotalPageFile, 4)
  }
  Emit @{
    event = "sample"
    totalPhys = [int64]$memory.ullTotalPhys
    availPhys = [int64]$memory.ullAvailPhys
    commitLimit = [int64]$memory.ullTotalPageFile
    commitCharge = $commit
    commitRatio = $ratio
    memoryLoad = [int]$memory.dwMemoryLoad
    cpuPercent = $cpu
    pageReadsPerSec = $counters.pageReads
    pageFaultsPerSec = $counters.pageFaults
    workingSetBytes = $counters.workingSet
    diskActivePercent = $counters.diskActive
    diskQueueLength = $counters.diskQueue
    diskTimePercent = $counters.diskTime
    defenderFound = $defender.found
    defenderCpuPercent = $defender.cpu
    defenderWorkingSetBytes = $defender.workingSet
    fileSystem = $volume.fileSystem
    devDrive = $volume.devDrive
    fsutil = $volume.fsutil
    drive = $volume.drive
    gpu = $gpu
    osBuild = $os.build
    osUbr = $os.ubr
    osProduct = $os.product
    cores = [int][Environment]::ProcessorCount
  }
}

if ($Action -eq "serve") {
  while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    $command = $line.Trim()
    if ($command -eq "exit" -or $command -eq "") {
      if ($command -eq "exit") { break }
      continue
    }
    if ($command.StartsWith("sample")) {
      $parts = $command.Split("|")
      if ($parts.Length -gt 1) { $VolumePath = $parts[1] }
      Emit-Sample
    } else {
      Emit @{ event = "error"; message = "unknown serve command" }
    }
  }
  exit 0
}

if ($Action -eq "sample") {
  $memory = Get-MemoryStatus
  $cpu = Get-CpuPercent
  $counters = Get-CounterSnapshot
  $defender = Get-DefenderCpu
  $volume = Get-VolumeInfo $VolumePath
  $gpu = Get-GpuName
  $os = Get-OsBuild
  $commit = [int64]$memory.ullTotalPageFile - [int64]$memory.ullAvailPageFile
  $ratio = 0
  if ([int64]$memory.ullTotalPageFile -gt 0) {
    $ratio = [math]::Round($commit / [double]$memory.ullTotalPageFile, 4)
  }
  Emit @{
    event = "sample"
    totalPhys = [int64]$memory.ullTotalPhys
    availPhys = [int64]$memory.ullAvailPhys
    commitLimit = [int64]$memory.ullTotalPageFile
    commitCharge = $commit
    commitRatio = $ratio
    memoryLoad = [int]$memory.dwMemoryLoad
    cpuPercent = $cpu
    pageReadsPerSec = $counters.pageReads
    pageFaultsPerSec = $counters.pageFaults
    workingSetBytes = $counters.workingSet
    diskActivePercent = $counters.diskActive
    diskQueueLength = $counters.diskQueue
    diskTimePercent = $counters.diskTime
    defenderFound = $defender.found
    defenderCpuPercent = $defender.cpu
    defenderWorkingSetBytes = $defender.workingSet
    fileSystem = $volume.fileSystem
    devDrive = $volume.devDrive
    fsutil = $volume.fsutil
    drive = $volume.drive
    gpu = $gpu
    osBuild = $os.build
    osUbr = $os.ubr
    osProduct = $os.product
    cores = [int][Environment]::ProcessorCount
  }
  exit 0
}

if ($Action -eq "job-hold") {
  if ($TargetPid -le 0) {
    Emit @{ event = "error"; message = "TargetPid is required" }
    exit 2
  }
  $access = [uint32]0x1F0FFF
  $process = [EfCapacityNative]::OpenProcess($access, $false, [uint32]$TargetPid)
  if ($process -eq [IntPtr]::Zero) {
    Emit @{ event = "error"; win32 = [Runtime.InteropServices.Marshal]::GetLastWin32Error(); message = "OpenProcess failed" }
    exit 3
  }
  $job = [EfCapacityNative]::CreateJobObject([IntPtr]::Zero, $null)
  if ($job -eq [IntPtr]::Zero) {
    [void][EfCapacityNative]::CloseHandle($process)
    Emit @{ event = "error"; win32 = [Runtime.InteropServices.Marshal]::GetLastWin32Error(); message = "CreateJobObject failed" }
    exit 4
  }
  $flags = [int]0x2000
  $limit = [uint64]0
  [void][uint64]::TryParse($MemoryLimitBytes, [ref]$limit)
  if ($limit -gt 0) { $flags = $flags -bor 0x200 }
  $pointer = [Runtime.InteropServices.Marshal]::AllocHGlobal(144)
  $readFlags = [int]0
  try {
    $zeros = New-Object byte[] 144
    [Runtime.InteropServices.Marshal]::Copy($zeros, 0, $pointer, 144)
    [Runtime.InteropServices.Marshal]::WriteInt32($pointer, 16, $flags)
    if ($limit -gt 0) {
      [Runtime.InteropServices.Marshal]::WriteInt64($pointer, 120, [int64]$limit)
    }
    $setOk = [EfCapacityNative]::SetInformationJobObject($job, 9, $pointer, 144)
    if (-not $setOk) {
      Emit @{ event = "error"; win32 = [Runtime.InteropServices.Marshal]::GetLastWin32Error(); message = "SetInformationJobObject failed" }
      exit 5
    }
    $queryOk = [EfCapacityNative]::QueryInformationJobObject($job, 9, $pointer, 144, [IntPtr]::Zero)
    if ($queryOk) {
      $readFlags = [Runtime.InteropServices.Marshal]::ReadInt32($pointer, 16)
    }
  } finally {
    [Runtime.InteropServices.Marshal]::FreeHGlobal($pointer)
  }
  $assigned = [EfCapacityNative]::AssignProcessToJobObject($job, $process)
  $assignError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
  [void][EfCapacityNative]::CloseHandle($process)
  if (-not $assigned) {
    [void][EfCapacityNative]::CloseHandle($job)
    Emit @{ event = "error"; win32 = $assignError; message = "AssignProcessToJobObject failed" }
    exit 6
  }
  Emit @{ event = "ready"; assigned = $true; pid = $TargetPid; limit = [int64]$limit; flags = [int64]$readFlags }
  try {
    while ($true) {
      $still = Get-Process -Id $TargetPid -ErrorAction SilentlyContinue
      if ($null -eq $still) { break }
      $status = Get-MemoryStatus
      $commit = [int64]$status.ullTotalPageFile - [int64]$status.ullAvailPageFile
      $ratio = 0
      if ([int64]$status.ullTotalPageFile -gt 0) {
        $ratio = $commit / [double]$status.ullTotalPageFile
      }
      $privateBytes = [int64]$still.PagedMemorySize64
      if ($ratio -gt 0.9 -or ($limit -gt 0 -and $privateBytes -gt [int64]$limit)) {
        [void][EfCapacityNative]::TerminateJobObject($job, 1)
        Emit @{ event = "oom"; commitRatio = [math]::Round($ratio, 4); privateBytes = $privateBytes }
        break
      }
      Start-Sleep -Milliseconds 150
    }
  } finally {
    [void][EfCapacityNative]::CloseHandle($job)
  }
  Emit @{ event = "closed"; pid = $TargetPid }
  exit 0
}

Emit @{ event = "error"; message = "unknown action" }
exit 2
