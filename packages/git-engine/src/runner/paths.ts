import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const OS_JUNK_NAMES = new Set([
  ".ds_store",
  "desktop.ini",
  "thumbs.db",
  "ehthumbs.db",
  "ehthumbs_vista.db",
]);

export function isOsJunkName(name: string): boolean {
  return OS_JUNK_NAMES.has(name.toLowerCase());
}

/**
 * Normalize Windows drive letters, slash direction, extended-length prefixes, and trailing separators.
 */
export function normalizeWindowsPath(input: string): string {
  let value = input.trim();
  if (/^\\\\\?\\unc\\/i.test(value)) {
    value = `\\\\${value.slice(8)}`;
  } else if (value.startsWith("\\\\?\\")) {
    value = value.slice(4);
  }
  value = value.replaceAll("/", "\\");
  if (value.startsWith("\\\\")) {
    value = `\\\\${value.slice(2).replace(/\\{2,}/g, "\\")}`;
  } else {
    value = value.replace(/\\{2,}/g, "\\");
  }
  const drive = /^([A-Za-z]):(.*)$/.exec(value);
  if (drive) {
    const letter = (drive[1] ?? "C").toUpperCase();
    const rest = drive[2] ?? "";
    value = `${letter}:${rest}`;
  }
  if (/^[A-Z]:\\$/.test(value)) return value;
  if (value.length > 1) value = value.replace(/\\+$/, "");
  return value;
}

export function normalizeRepoPath(input: string): string {
  const normalized = process.platform === "win32" ? normalizeWindowsPath(input) : path.resolve(input);
  try {
    const real = fs.realpathSync.native(normalized);
    return process.platform === "win32" ? normalizeWindowsPath(real) : real;
  } catch {
    return normalized;
  }
}

export function isUncPath(input: string): boolean {
  const normalized = process.platform === "win32" ? normalizeWindowsPath(input) : input.replaceAll("/", "\\");
  return normalized.startsWith("\\\\") && !normalized.startsWith("\\\\?\\");
}

/**
 * Ask a short-lived child whether a directory exists.
 * UNC shares can block inside the Windows redirector, so the probe is killed on timeout
 * instead of stalling folder inspection on the main thread.
 */
export function probeDirectoryExists(folder: string, timeoutMs = 3_000): boolean {
  const result = spawnSync(
    process.execPath,
    [
      "-e",
      "const fs=require('node:fs');const target=process.argv[1];let ok=false;try{ok=!!target&&fs.existsSync(target)&&fs.statSync(target).isDirectory();}catch{ok=false;}process.exit(ok?0:2);",
      folder,
    ],
    {
      timeout: timeoutMs,
      windowsHide: true,
      shell: false,
      encoding: "utf8",
    },
  );
  return result.status === 0;
}

export function directoryExists(folder: string): boolean {
  if (isUncPath(folder)) return probeDirectoryExists(folder);
  try {
    return fs.existsSync(folder) && fs.statSync(folder).isDirectory();
  } catch {
    return false;
  }
}

function usesWindowsContainment(child: string, parent: string): boolean {
  if (process.platform === "win32") return true;
  return [child, parent].some((input) => {
    const value = input.trim();
    return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\") || value.startsWith("//");
  });
}

export function pathIsInside(child: string, parent: string): boolean {
  if (!parent.trim()) return false;
  if (usesWindowsContainment(child, parent)) {
    const left = normalizeWindowsPath(child).toLowerCase();
    const right = normalizeWindowsPath(parent).toLowerCase();
    return left === right || left.startsWith(`${right}\\`);
  }
  const left = path.resolve(child);
  const right = path.resolve(parent);
  return left === right || left.startsWith(`${right}${path.sep}`);
}

export function bundledMinGitPath(resourcesRoot: string): string {
  return path.join(resourcesRoot, "mingit", "cmd", "git.exe");
}

export function resourcesRootFromProcess(): string | null {
  const fromEnv = process.env.EF_HARNESS_RESOURCES;
  if (typeof fromEnv === "string" && fromEnv.trim()) return fromEnv;
  const electron = process as NodeJS.Process & { resourcesPath?: string };
  if (typeof electron.resourcesPath === "string" && electron.resourcesPath.trim()) {
    return electron.resourcesPath;
  }
  return null;
}

export function definedEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") clean[key] = value;
  }
  return clean;
}

/**
 * Disable interactive credential prompts without changing line-ending or attribute config.
 */
export function scrubGitEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...definedEnv(env),
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "Never",
  };
}

export function hasPathSegment(folder: string, segment: string): boolean {
  const normalized = process.platform === "win32" ? normalizeWindowsPath(folder) : path.resolve(folder);
  const parts = normalized.split(/[\\/]/);
  const needle = segment.toLowerCase();
  return parts.some((part) => part.toLowerCase() === needle);
}

export function ancestorHasEntry(start: string, name: string): boolean {
  let current = start;
  for (let depth = 0; depth < 40; depth += 1) {
    if (fs.existsSync(path.join(current, name))) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
  return false;
}
