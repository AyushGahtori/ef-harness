import fs from "node:fs";
import path from "node:path";
import {
  FileNotFoundError,
  NotAFileError,
  PackageRootDeniedError,
  PathEscapeDeniedError,
  SecretFileDeniedError,
} from "./errors.js";
import type { SecretRedactorPort } from "./secret-redactor.js";

export interface ResolvedFile {
  readonly realPath: string;
  readonly relativePath: string;
  readonly root: string;
}

export function isSecretFile(filePath: string): boolean {
  const normalized = filePath.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (segments.some((segment) => segment.toLowerCase() === ".git")) return true;
  const base = path.basename(normalized).toLowerCase();
  if (base === ".env" || base.startsWith(".env")) return true;
  if (base.endsWith(".pem") || base.endsWith(".key")) return true;
  return false;
}

export function relativePosix(root: string, full: string): string {
  return path.relative(root, full).replaceAll("\\", "/");
}

export function isInsideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  if (relative === "") return true;
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || relative.startsWith("../")) return false;
  return !path.isAbsolute(relative);
}

export function pathsEqual(left: string, right: string): boolean {
  const a = path.normalize(left);
  const b = path.normalize(right);
  if (process.platform === "win32") return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

export function assertWorktreeDirectory(worktreePath: string): string {
  if (!fs.existsSync(worktreePath)) {
    throw new FileNotFoundError(worktreePath);
  }
  const real = fs.realpathSync(worktreePath);
  if (!fs.statSync(real).isDirectory()) {
    throw new NotAFileError(worktreePath);
  }
  return real;
}

export function resolveReadableFile(options: {
  readonly worktreeReal: string;
  readonly requestedPath: string;
  readonly allowRoots: readonly string[];
  readonly redactor: SecretRedactorPort;
  readonly allowPackageRoots: boolean;
}): ResolvedFile {
  const absolute = path.isAbsolute(options.requestedPath)
    ? options.requestedPath
    : path.resolve(options.worktreeReal, options.requestedPath);
  const located = locateReal(absolute);
  const allowed =
    isInsideRoot(options.worktreeReal, located.realPath) ||
    (options.allowPackageRoots && isAllowlisted(located.realPath, options.allowRoots));
  if (!allowed) {
    throw new PathEscapeDeniedError(options.redactor.redact(options.requestedPath));
  }
  if (isSecretFile(options.requestedPath) || isSecretFile(located.realPath)) {
    throw new SecretFileDeniedError(options.redactor.redact(options.requestedPath));
  }
  if (!located.exists) {
    throw new FileNotFoundError(options.redactor.redact(options.requestedPath));
  }
  if (!fs.statSync(located.realPath).isFile()) {
    throw new NotAFileError(options.redactor.redact(options.requestedPath));
  }
  const root = isInsideRoot(options.worktreeReal, located.realPath)
    ? options.worktreeReal
    : owningAllowRoot(located.realPath, options.allowRoots) ?? options.worktreeReal;
  return {
    realPath: located.realPath,
    relativePath: relativePosix(root, located.realPath),
    root,
  };
}

export function resolvePackageFile(options: {
  readonly packageRoot: string;
  readonly relativePath: string;
  readonly allowRoots: readonly string[];
  readonly redactor: SecretRedactorPort;
}): ResolvedFile {
  if (!fs.existsSync(options.packageRoot)) {
    throw new PackageRootDeniedError(options.redactor.redact(options.packageRoot));
  }
  const rootReal = fs.realpathSync(options.packageRoot);
  if (!isAllowlisted(rootReal, options.allowRoots)) {
    throw new PackageRootDeniedError(options.redactor.redact(options.packageRoot));
  }
  return resolveReadableFile({
    worktreeReal: rootReal,
    requestedPath: options.relativePath,
    allowRoots: options.allowRoots,
    redactor: options.redactor,
    allowPackageRoots: true,
  });
}

function isAllowlisted(realPath: string, allowRoots: readonly string[]): boolean {
  for (const root of allowRoots) {
    if (!fs.existsSync(root)) continue;
    const rootReal = fs.realpathSync(root);
    if (isInsideRoot(rootReal, realPath)) return true;
  }
  return false;
}

function owningAllowRoot(realPath: string, allowRoots: readonly string[]): string | null {
  for (const root of allowRoots) {
    if (!fs.existsSync(root)) continue;
    const rootReal = fs.realpathSync(root);
    if (isInsideRoot(rootReal, realPath)) return rootReal;
  }
  return null;
}

function locateReal(absolute: string): { realPath: string; exists: boolean } {
  const missing: string[] = [];
  let current = absolute;
  const filesystemRoot = path.parse(current).root;
  while (!fs.existsSync(current)) {
    if (pathsEqual(current, filesystemRoot)) {
      throw new PathEscapeDeniedError(absolute);
    }
    missing.unshift(path.basename(current));
    const parent = path.dirname(current);
    if (parent === current) throw new PathEscapeDeniedError(absolute);
    current = parent;
  }
  let real = fs.realpathSync(current);
  for (const segment of missing) {
    real = path.join(real, segment);
  }
  return { realPath: real, exists: missing.length === 0 };
}
