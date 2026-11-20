import path from "node:path";
import { NetworkPathRejectedError, PathTraversalError } from "./errors.js";
import type { PathClass } from "./types.js";

export function classifyPathSyntax(target: string): "unc" | "local" {
  const normalized = target.replaceAll("/", "\\");
  if (normalized.startsWith("\\\\?\\UNC\\") || normalized.startsWith("\\\\.\\UNC\\")) return "unc";
  if (normalized.startsWith("\\\\?\\") || normalized.startsWith("\\\\.\\")) return "local";
  if (normalized.startsWith("\\\\")) return "unc";
  return "local";
}

export function assertSafeAbsolutePath(target: string): string {
  if (classifyPathSyntax(target) === "unc") throw new NetworkPathRejectedError(target);
  const segments = target.split(/[\\/]+/);
  if (segments.includes("..") || segments.includes("~")) {
    throw new PathTraversalError(target);
  }
  const resolved = path.resolve(target);
  if (!path.isAbsolute(resolved)) throw new PathTraversalError(target);
  return resolved;
}

export function pathClassFromDrive(drive: string): PathClass {
  if (drive === "unc" || drive === "remote") return drive === "unc" ? "unc" : "network";
  return "local";
}
