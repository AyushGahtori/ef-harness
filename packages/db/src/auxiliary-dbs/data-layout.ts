import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DataRootPrivacy } from "./types.js";
import { assertProjectId } from "./project-path.js";

export interface HarnessDataLayout {
  readonly root: string;
  readonly globalDbPath: string;
  readonly globalLockPath: string;
  readonly projectsDir: string;
  readonly casSha256Dir: string;
  readonly casTmpDir: string;
  readonly worktreesDir: string;
  readonly componentsDir: string;
  readonly logsDir: string;
  readonly privacy: DataRootPrivacy;
  projectDir(projectId: string): string;
  projectBackupsDir(projectId: string): string;
  projectEnvsDir(projectId: string): string;
  projectStatePath(projectId: string): string;
  projectTelemetryPath(projectId: string): string;
  projectCodeIndexPath(projectId: string): string;
  ensureProject(projectId: string): void;
}

export interface EnsureHarnessDataLayoutOptions {
  readonly root?: string;
  readonly projectIds?: readonly string[];
}

export function defaultHarnessDataRoot(): string {
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData !== undefined && localAppData.trim().length > 0) {
      return path.join(localAppData, "EFHarness");
    }
    return path.join(os.homedir(), "AppData", "Local", "EFHarness");
  }
  return path.join(os.homedir(), ".local", "share", "EFHarness");
}

export function assessDataRootPrivacy(root: string): DataRootPrivacy {
  const resolved = path.resolve(root);
  const localAppData = readLocalAppData();
  const insideLocalAppData =
    localAppData !== null && isPathInside(resolved, path.resolve(localAppData));
  if (insideLocalAppData) {
    return { insideLocalAppData: true, worldReadable: false, warning: null };
  }
  const knownWorldReadable = isKnownWorldReadable(resolved);
  const aclWorldReadable =
    !knownWorldReadable && fs.existsSync(resolved) ? aclAllowsOtherUsers(resolved) : false;
  const worldReadable = knownWorldReadable || aclWorldReadable;
  return {
    insideLocalAppData: false,
    worldReadable,
    warning: worldReadable
      ? `Data root ${resolved} is outside the user-private LOCALAPPDATA folder and is world-readable. Keep harness data private; Settings → Storage can relocate it onto a private Dev Drive.`
      : null,
  };
}

export function ensureHarnessDataLayout(
  options: EnsureHarnessDataLayoutOptions = {},
): HarnessDataLayout {
  const root = path.resolve(options.root ?? defaultHarnessDataRoot());
  const projectsDir = path.join(root, "projects");
  const directories = [
    root,
    projectsDir,
    path.join(root, "cas", "sha256"),
    path.join(root, "cas", "tmp"),
    path.join(root, "wt"),
    path.join(root, "components"),
    path.join(root, "logs"),
  ];
  for (const directory of directories) {
    fs.mkdirSync(directory, { recursive: true });
  }
  const layout = createLayout(root, projectsDir, assessDataRootPrivacy(root));
  for (const projectId of options.projectIds ?? []) {
    layout.ensureProject(projectId);
  }
  return layout;
}

function createLayout(root: string, projectsDir: string, privacy: DataRootPrivacy): HarnessDataLayout {
  const projectDir = (projectId: string): string =>
    path.join(projectsDir, assertProjectId(projectId));
  return {
    root,
    globalDbPath: path.join(root, "global.db"),
    globalLockPath: path.join(root, "global.db.lock"),
    projectsDir,
    casSha256Dir: path.join(root, "cas", "sha256"),
    casTmpDir: path.join(root, "cas", "tmp"),
    worktreesDir: path.join(root, "wt"),
    componentsDir: path.join(root, "components"),
    logsDir: path.join(root, "logs"),
    privacy,
    projectDir,
    projectBackupsDir: (projectId) => path.join(projectDir(projectId), "backups"),
    projectEnvsDir: (projectId) => path.join(projectDir(projectId), "envs"),
    projectStatePath: (projectId) => path.join(projectDir(projectId), "state.db"),
    projectTelemetryPath: (projectId) => path.join(projectDir(projectId), "telemetry.db"),
    projectCodeIndexPath: (projectId) => path.join(projectDir(projectId), "code-index.db"),
    ensureProject(projectId) {
      const directory = projectDir(projectId);
      fs.mkdirSync(path.join(directory, "backups"), { recursive: true });
      fs.mkdirSync(path.join(directory, "envs"), { recursive: true });
    },
  };
}

function readLocalAppData(): string | null {
  if (process.platform !== "win32") return null;
  const value = process.env.LOCALAPPDATA;
  if (value === undefined || value.trim().length === 0) return null;
  return value;
}

function isPathInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isKnownWorldReadable(resolved: string): boolean {
  if (process.platform === "win32") {
    const lower = resolved.toLowerCase();
    if (/^[a-z]:\\$/u.test(lower)) return true;
    if (lower.endsWith("\\users\\public") || lower.includes("\\users\\public\\")) return true;
    if (lower.endsWith("\\programdata") || lower.includes("\\programdata\\")) return true;
    return false;
  }
  return resolved === "/tmp" || resolved.startsWith("/tmp/");
}

function aclAllowsOtherUsers(target: string): boolean {
  if (process.platform !== "win32") {
    try {
      const mode = fs.statSync(target).mode;
      return (mode & 0o004) !== 0;
    } catch {
      return false;
    }
  }
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$acl = Get-Acl -LiteralPath $env:EF_ACL_PATH",
    "foreach ($ace in $acl.Access) {",
    "  if ($ace.AccessControlType.ToString() -ne 'Allow') { continue }",
    "  $sid = $null",
    "  try { $sid = $ace.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value } catch { continue }",
    "  if ($sid -ne 'S-1-1-0' -and $sid -ne 'S-1-5-11' -and $sid -ne 'S-1-5-32-545') { continue }",
    "  $rights = [int]$ace.FileSystemRights",
    "  if ((($rights -band 1) -ne 0) -or (($rights -band 1179785) -ne 0)) { Write-Output 'world'; exit 0 }",
    "}",
    "Write-Output 'private'",
  ].join("\n");
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10_000,
      env: { ...process.env, EF_ACL_PATH: target },
    },
  );
  if (result.status !== 0) return false;
  return result.stdout.includes("world");
}
