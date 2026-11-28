import path from "node:path";

const SENSITIVE_BASENAMES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  "id_rsa",
  "credentials.json",
]);

const SENSITIVE_SUFFIXES = [".pem", ".key"] as const;

export function isSensitivePath(relPath: string): boolean {
  const normalized = relPath.replaceAll("\\", "/");
  const base = path.posix.basename(normalized);
  if (SENSITIVE_BASENAMES.has(base)) return true;
  if (base.startsWith("secrets.")) return true;
  for (const suffix of SENSITIVE_SUFFIXES) {
    if (base.endsWith(suffix)) return true;
  }
  return false;
}

/**
 * Local port of Task 036 `SafetyScanner` — path gate only; L0 never reads secret file bytes.
 */
export class SafetyScanner {
  shouldSkipRead(relPath: string): boolean {
    return isSensitivePath(relPath);
  }
}