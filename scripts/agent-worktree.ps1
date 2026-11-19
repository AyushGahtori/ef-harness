# Windows wrapper for the worktree harmony CLI.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  & node (Join-Path $PSScriptRoot "agent-worktree.mjs") @args
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}
