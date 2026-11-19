# Idempotent developer bootstrap: OpenCode on PATH, pnpm 10, and repo git safety settings.
$ErrorActionPreference = "Stop"

function Add-SessionPath([string]$Directory) {
  if (-not $Directory) { return }
  if (-not (Test-Path $Directory)) { return }
  $parts = $env:Path -split ";"
  if ($parts -notcontains $Directory) {
    $env:Path = "$Directory;$env:Path"
  }
}

function Find-OpenCode {
  Add-SessionPath (Join-Path $env:USERPROFILE ".opencode\bin")
  Add-SessionPath (Join-Path $env:APPDATA "npm")
  Add-SessionPath (Join-Path $env:LOCALAPPDATA "Programs\opencode")
  $cmd = Get-Command opencode -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidates = @(
    (Join-Path $env:USERPROFILE ".opencode\bin\opencode.exe"),
    (Join-Path $env:USERPROFILE ".opencode\bin\opencode.cmd"),
    (Join-Path $env:APPDATA "npm\opencode.cmd"),
    (Join-Path $env:LOCALAPPDATA "Programs\opencode\opencode.exe")
  )
  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) { return $candidate }
  }
  return $null
}

Add-SessionPath (Join-Path $env:USERPROFILE ".opencode\bin")
Add-SessionPath (Join-Path $env:APPDATA "npm")

if (-not (Find-OpenCode)) {
  Write-Host "OpenCode was not found. Installing with npm i -g opencode-ai"
  & npm i -g opencode-ai
}

if (-not (Find-OpenCode) -and (Get-Command winget -ErrorAction SilentlyContinue)) {
  Write-Host "Trying winget install of OpenCode"
  & winget install --id SST.opencode -e --accept-package-agreements --accept-source-agreements
}

if (-not (Find-OpenCode) -and (Get-Command scoop -ErrorAction SilentlyContinue)) {
  Write-Host "Trying scoop install opencode"
  & scoop install opencode
}

$opencode = Find-OpenCode
if (-not $opencode) {
  throw "OpenCode is not installed. Run: npm i -g opencode-ai"
}
Add-SessionPath (Split-Path -Parent $opencode)

& opencode --version
if ($LASTEXITCODE -ne 0) { throw "opencode --version failed" }
& opencode acp --help | Out-Null
if ($LASTEXITCODE -ne 0) { throw "opencode acp --help failed" }

Add-SessionPath (Join-Path $env:APPDATA "npm")
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Write-Host "Installing pnpm 10"
  & npm i -g pnpm@10
}
$pnpmVersion = (& pnpm --version).Trim()
if ($pnpmVersion -notmatch "^10\.") {
  throw "pnpm 10.x is required, found $pnpmVersion"
}

$repo = Split-Path -Parent $PSScriptRoot
Push-Location $repo
try {
  & git config core.longpaths true
  & git config core.autocrlf false
  & git config init.defaultBranch main
  & git config fetch.prune true
  & git config core.hooksPath .githooks
} finally {
  Pop-Location
}

Write-Host "OpenCode $(& opencode --version) and pnpm $pnpmVersion are ready."
