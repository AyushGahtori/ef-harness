$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$WarningPreference = "SilentlyContinue"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false

function Write-Response([string]$text) {
  [Console]::Out.WriteLine($text)
  [Console]::Out.Flush()
}

function Convert-Response($obj) {
  return ($obj | ConvertTo-Json -Compress -Depth 8)
}

function Test-LocalUserName([string]$name) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = Join-Path $env:SystemRoot "System32\net.exe"
  $psi.Arguments = "user $name"
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $psi
  [void]$process.Start()
  [void]$process.WaitForExit()
  return $process.ExitCode -eq 0
}

function Get-VolumeRecord([string]$target) {
  if ($target.StartsWith("\\") -or $target.StartsWith("//")) {
    return @{
      ok = $true
      kind = "unc"
      aclCapable = $false
      fileSystem = $null
      driveType = "unc"
      driveTypeCode = 4
      reason = "UNC path"
    }
  }
  $full = [System.IO.Path]::GetFullPath($target)
  $root = [System.IO.Path]::GetPathRoot($full)
  if ([string]::IsNullOrWhiteSpace($root)) {
    return @{ ok = $false; reason = "no_drive_root"; detail = $target }
  }
  $device = $root.TrimEnd("\")
  $safe = $device.Replace("'", "")
  $disk = Get-CimInstance -ClassName Win32_LogicalDisk -Filter ("DeviceID='" + $safe + "'")
  if ($null -eq $disk) {
    return @{ ok = $false; reason = "volume_not_found"; device = $device }
  }
  $typeCode = [int]$disk.DriveType
  $typeName = switch ($typeCode) {
    2 { "removable" }
    3 { "local" }
    4 { "network" }
    5 { "cdrom" }
    default { "unknown" }
  }
  $fileSystem = [string]$disk.FileSystem
  $acl = ($fileSystem -eq "NTFS" -or $fileSystem -eq "ReFS") -and $typeCode -ne 4
  return @{
    ok = $true
    kind = $(if ($typeCode -eq 4) { "network" } else { $fileSystem.ToLowerInvariant() })
    aclCapable = [bool]$acl
    fileSystem = $fileSystem
    driveType = $typeName
    driveTypeCode = $typeCode
    device = $device
    reason = $null
  }
}

try {
  $sourcePath = Join-Path $PSScriptRoot "EfWin32.cs"
  $source = [System.IO.File]::ReadAllText($sourcePath)
  Add-Type -TypeDefinition $source -ReferencedAssemblies "System.Web.Extensions"
} catch {
  [Console]::Error.WriteLine($_.Exception.ToString())
  exit 1
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line.Trim().Length -eq 0) { continue }
  $id = $null
  try {
    $req = $line | ConvertFrom-Json
    $id = $req.id
    if ($req.op -eq "exit") { break }
    if ($req.op -eq "users") {
      $offline = Test-LocalUserName "EFHarnessSandboxOffline"
      $online = Test-LocalUserName "EFHarnessSandboxOnline"
      Write-Response (Convert-Response @{
        ok = $true
        id = $id
        offline = [bool]$offline
        online = [bool]$online
        offlineName = "EFHarnessSandboxOffline"
        onlineName = "EFHarnessSandboxOnline"
      })
      continue
    }
    if ($req.op -eq "volume") {
      $record = Get-VolumeRecord ([string]$req.path)
      $record.id = $id
      if (-not $record.ContainsKey("ok")) { $record.ok = $true }
      Write-Response (Convert-Response $record)
      continue
    }
    Write-Response ([EfWin32]::Dispatch($line.Trim()))
  } catch {
    $message = $_.Exception.Message
    if ($message.Length -gt 800) { $message = $message.Substring(0, 800) }
    Write-Response (Convert-Response @{
      ok = $false
      id = $id
      reason = "helper_exception"
      detail = $message
    })
  }
}
