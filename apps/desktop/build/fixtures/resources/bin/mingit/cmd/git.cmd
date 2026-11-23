@echo off
setlocal
if "%1"=="--version" (
  echo git version 2.45.0.windows.ef-harness-mingit
  exit /b 0
)
if "%1"=="init" (
  if not exist ".git" mkdir ".git"
  echo ref: refs/heads/main> ".git\HEAD"
  exit /b 0
)
if "%1"=="status" (
  echo On branch main
  echo nothing to commit, working tree clean
  exit /b 0
)
echo mingit-stub: unsupported command %*
exit /b 1