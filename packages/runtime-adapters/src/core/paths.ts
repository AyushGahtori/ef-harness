import { realpathSync } from "node:fs";
import path from "node:path";

const CREDENTIAL_SEGMENTS = new Set([".ssh", ".aws", ".gnupg", ".claude", ".codex", ".gemini"]);
const HOST_DATABASES = new Set(["state.db", "global.db"]);

export interface PathResolveOptions {
  readonly worktreeRoot: string;
  readonly cwd?: string;
  readonly homeDir?: string;
  readonly appData?: string;
  readonly realpath?: (target: string) => string;
}

export type PathContainment = "inside" | "symlink_escape" | "outside";

export interface ResolvedPath {
  readonly requested: string;
  readonly absolute: string;
  readonly relative: string | null;
  readonly containment: PathContainment;
  readonly credential: boolean;
  readonly appData: boolean;
  readonly hostDatabase: boolean;
}

export function resolveAgainstWorktree(requested: string, options: PathResolveOptions): ResolvedPath {
  const realpath = options.realpath ?? defaultRealpath;
  const lexicalRoot = path.resolve(options.worktreeRoot);
  const root = canonicalize(lexicalRoot, realpath);
  const cwd = options.cwd ? path.resolve(options.cwd) : root;
  const expanded = expandUserPath(requested, options.homeDir, options.appData);
  const absoluteLexical = path.resolve(cwd, expanded);
  const absolute = canonicalize(absoluteLexical, realpath);
  const inside = isInside(root, absolute);
  const lexicalInside = isInside(lexicalRoot, absoluteLexical) || isInside(root, absoluteLexical);
  const containment: PathContainment = inside
    ? "inside"
    : lexicalInside
      ? "symlink_escape"
      : "outside";
  const relative = inside ? toPosix(path.relative(root, absolute)) : null;
  const credential = hasCredentialSegment(absolute) || hasCredentialSegment(expanded);
  const appDataRoot = options.appData ? canonicalize(path.resolve(options.appData), realpath) : null;
  const appData = appDataRoot ? isInside(appDataRoot, absolute) : false;
  const base = path.basename(absolute).toLowerCase();
  const hostDatabase = !inside && HOST_DATABASES.has(base);
  return {
    requested,
    absolute,
    relative,
    containment,
    credential,
    appData,
    hostDatabase,
  };
}

export function hasCredentialSegment(value: string): boolean {
  return value
    .split(/[\\/]+/)
    .some((segment) => CREDENTIAL_SEGMENTS.has(segment.toLowerCase()));
}

export function canonicalize(target: string, realpath: (value: string) => string): string {
  const normalized = path.normalize(target);
  const suffix: string[] = [];
  let current = normalized;
  for (;;) {
    try {
      const real = stripExtended(realpath(current));
      return suffix.length === 0 ? path.normalize(real) : path.normalize(path.join(real, ...suffix));
    } catch (error) {
      if (!isMissingPath(error) && suffix.length > 32) return path.normalize(normalized);
      const parent = path.dirname(current);
      if (parent === current) return path.normalize(normalized);
      const base = path.basename(current);
      suffix.unshift(base);
      current = parent;
    }
  }
}

function defaultRealpath(target: string): string {
  return realpathSync(target);
}

function expandUserPath(input: string, homeDir: string | undefined, appData: string | undefined): string {
  let value = input.trim();
  if (appData) value = value.replace(/%APPDATA%/gi, appData);
  if (homeDir) {
    value = value.replace(/%USERPROFILE%/gi, homeDir);
    if (value === "~") return homeDir;
    if (value.startsWith("~/") || value.startsWith("~\\")) return path.join(homeDir, value.slice(2));
  }
  return value;
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(path.normalize(root), path.normalize(target));
  if (relative === "") return true;
  if (relative.startsWith("..")) return false;
  if (path.isAbsolute(relative)) return false;
  return true;
}

function toPosix(value: string): string {
  return value.replaceAll("\\", "/");
}

function stripExtended(value: string): string {
  return value.startsWith("\\\\?\\") ? value.slice(4) : value;
}

function isMissingPath(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
