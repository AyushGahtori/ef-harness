import path from "node:path";

export function toPosix(value: string): string {
  return value.replaceAll("\\", "/");
}

export function relativePosix(root: string, absolutePath: string): string {
  return toPosix(path.relative(root, absolutePath));
}

export function isInsideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (relative === "") return true;
  if (relative.startsWith("..")) return false;
  if (path.isAbsolute(relative)) return false;
  return true;
}

export function assertRevision(revision: string): void {
  if (revision.length === 0 || revision.length > 200) {
    throw new Error("invalid git revision");
  }
  if (revision.startsWith("-") || /[\0\r\n]/.test(revision)) {
    throw new Error("invalid git revision");
  }
  if (!/^[A-Za-z0-9._/^~:@-]+$/.test(revision)) {
    throw new Error("invalid git revision");
  }
}

export function isFixturePath(relativePath: string): boolean {
  const value = toPosix(relativePath);
  if (/(^|\/)(tests?|__tests__|fixtures?|testdata|__fixtures__)(\/|$)/.test(value)) {
    return true;
  }
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(value)) return true;
  if (/\.(?:test|spec)\.py$/.test(value)) return true;
  return false;
}

export function basenamePosix(relativePath: string): string {
  const value = toPosix(relativePath);
  const slash = value.lastIndexOf("/");
  return slash === -1 ? value : value.slice(slash + 1);
}
