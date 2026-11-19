import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WorldReadableProjectPathError } from "./errors.js";

const PROJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export interface ProjectPaths {
  rootDir: string;
  projectDir: string;
  databasePath: string;
  lockPath: string;
  backupDirectory: string;
  initTempPath: string;
}

export function defaultHarnessRoot(): string {
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    if (!localAppData) {
      throw new Error("LOCALAPPDATA is not set; cannot locate the EFHarness data directory.");
    }
    return path.join(localAppData, "EFHarness");
  }
  const base = process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share");
  return path.join(base, "EFHarness");
}

export function assertProjectId(projectId: string): void {
  if (!PROJECT_ID_PATTERN.test(projectId) || WINDOWS_RESERVED.test(projectId)) {
    throw new Error(
      `Project id ${JSON.stringify(projectId)} is not a single path segment. Use letters, digits, '.', '_' or '-'.`,
    );
  }
}

export function resolveProjectPaths(projectId: string, rootDir?: string): ProjectPaths {
  assertProjectId(projectId);
  const root = path.resolve(rootDir ?? defaultHarnessRoot());
  const projectDir = path.join(root, "projects", projectId);
  assertPrivateProjectPath(projectDir);
  return {
    rootDir: root,
    projectDir,
    databasePath: path.join(projectDir, "state.db"),
    lockPath: path.join(projectDir, "state.db.lock"),
    backupDirectory: path.join(projectDir, "backups"),
    initTempPath: path.join(projectDir, "state.db.init.tmp"),
  };
}

/**
 * state.db inherits the current user's profile ACLs when created under LOCALAPPDATA.
 * Shared folders such as Public and ProgramData are rejected before any file is created.
 */
export function assertPrivateProjectPath(projectDir: string): void {
  const resolved = path.resolve(projectDir);
  if (process.platform !== "win32") return;
  const lowered = resolved.toLowerCase();
  for (const root of sharedWindowsRoots()) {
    if (lowered === root || lowered.startsWith(`${root}\\`)) {
      throw new WorldReadableProjectPathError(resolved);
    }
  }
}

export function ensureProjectDirectories(paths: ProjectPaths): void {
  fs.mkdirSync(paths.projectDir, { recursive: true });
  fs.mkdirSync(paths.backupDirectory, { recursive: true });
  tightenDirectoryPermissions(paths.projectDir);
  tightenDirectoryPermissions(paths.backupDirectory);
}

export function tightenDirectoryPermissions(directory: string): void {
  if (process.platform === "win32") return;
  fs.chmodSync(directory, 0o700);
}

export function tightenDatabasePermissions(filePath: string): void {
  if (process.platform === "win32") return;
  fs.chmodSync(filePath, 0o600);
}

function sharedWindowsRoots(): string[] {
  const candidates = [
    process.env.PUBLIC,
    process.env.ProgramData,
    "C:\\Users\\Public",
    "C:\\ProgramData",
  ];
  const roots = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate) continue;
    roots.add(path.resolve(candidate).toLowerCase());
  }
  return [...roots];
}
