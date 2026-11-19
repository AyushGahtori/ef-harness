import fs from "node:fs/promises";
import path from "node:path";
import { SecretConfigCopyRejectedError } from "./errors.js";
import type { EnvironmentManifest, RejectedConfigPath, ResolvedEnvironmentManifest } from "./types.js";

export function resolveEnvironmentManifest(
  manifest: EnvironmentManifest | undefined,
  mainRepoPath: string,
): ResolvedEnvironmentManifest {
  return {
    allowlistedConfigFiles: manifest?.allowlistedConfigFiles ?? [],
    preserveIgnored: manifest?.preserveIgnored ?? [],
    vaultNames: manifest?.vaultNames ?? [],
    sourceRoot: manifest?.sourceRoot ?? mainRepoPath,
  };
}

export function rejectedConfigPath(relativePath: string, vaultNames: readonly string[]): RejectedConfigPath | null {
  const normalized = relativePath.replaceAll("\\", "/").replace(/^\.\//, "");
  if (normalized.length === 0) {
    return { path: relativePath, reason: "path_traversal" };
  }
  if (path.win32.isAbsolute(normalized) || path.posix.isAbsolute(normalized)) {
    return { path: relativePath, reason: "absolute" };
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === ".." || segment === "")) {
    return { path: relativePath, reason: "path_traversal" };
  }
  for (const segment of segments) {
    if (segment.startsWith(".env")) {
      return { path: relativePath, reason: "env_file" };
    }
    const lower = segment.toLowerCase();
    if (lower.endsWith(".pem")) return { path: relativePath, reason: "pem" };
    if (lower.endsWith(".key")) return { path: relativePath, reason: "key" };
  }
  const vault = new Set(vaultNames.map((name) => name.toLowerCase()));
  if (vault.has(normalized.toLowerCase())) {
    return { path: relativePath, reason: "vault_name" };
  }
  for (const segment of segments) {
    if (vault.has(segment.toLowerCase())) {
      return { path: relativePath, reason: "vault_name" };
    }
  }
  return null;
}

export function assertConfigAllowlistSafe(files: readonly string[], vaultNames: readonly string[]): void {
  const rejected: RejectedConfigPath[] = [];
  for (const file of files) {
    const reason = rejectedConfigPath(file, vaultNames);
    if (reason) rejected.push(reason);
  }
  if (rejected.length > 0) throw new SecretConfigCopyRejectedError(rejected);
}

export async function copyAllowlistedConfig(
  sourceRoot: string,
  slotPath: string,
  files: readonly string[],
): Promise<void> {
  const sourceRootResolved = path.resolve(sourceRoot);
  const slotResolved = path.resolve(slotPath);
  for (const file of files) {
    const source = path.resolve(sourceRootResolved, file);
    const destination = path.resolve(slotResolved, file);
    assertInside(sourceRootResolved, source);
    assertInside(slotResolved, destination);
    const stat = await fs.lstat(source);
    if (stat.isSymbolicLink()) {
      throw new SecretConfigCopyRejectedError([{ path: file, reason: "path_traversal" }]);
    }
    if (!stat.isFile()) {
      throw new Error(`allowlisted config is not a file: ${file}`);
    }
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
  }
}

function assertInside(root: string, candidate: string): void {
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new SecretConfigCopyRejectedError([{ path: candidate, reason: "path_traversal" }]);
  }
}
