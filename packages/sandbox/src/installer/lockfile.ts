import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { LockfileIntegrityError } from "./errors.js";
import type {
  IntegrityCheckOptions,
  LockfileIntegrityFailure,
  LockfileIntegrityReport,
  LockfilePackageRecord,
  PackageManager,
} from "./types.js";

export const DEFAULT_REGISTRY_HOSTS = [
  "registry.npmjs.org",
  "registry.yarnpkg.com",
  "pypi.org",
  "files.pythonhosted.org",
  "pypi.python.org",
] as const;

export function managerForLockfile(lockfilePath: string): PackageManager {
  const base = path.basename(lockfilePath).toLowerCase();
  if (base === "pnpm-lock.yaml" || base === "pnpm-lock.yml") return "pnpm";
  if (base === "package-lock.json" || base === "npm-shrinkwrap.json") return "npm";
  if (base === "yarn.lock") return "yarn";
  throw new LockfileIntegrityError([
    {
      name: base,
      version: "",
      code: "missing_sha512",
      detail: `Unsupported lockfile ${base}. Expected pnpm-lock.yaml, package-lock.json, or yarn.lock.`,
    },
  ]);
}

function unquote(value: string): string {
  const trimmed = value.trim().replace(/,$/, "");
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parsePnpmKey(raw: string): { name: string; version: string } | null {
  const withoutPeers = raw.replace(/\([^)]*\)$/, "");
  const at = withoutPeers.lastIndexOf("@");
  if (at <= 0) return null;
  const name = withoutPeers.slice(0, at);
  const version = withoutPeers.slice(at + 1);
  if (!name || !version) return null;
  return { name, version };
}

function parsePnpmLock(text: string): LockfilePackageRecord[] {
  const records: LockfilePackageRecord[] = [];
  let section = "";
  let current: { name: string; version: string } | null = null;
  let integrity: string | null = null;
  let tarball: string | null = null;
  let inResolution = false;
  const flush = (): void => {
    if (!current) return;
    const local = tarball !== null && /^(file:|link:)/.test(tarball);
    records.push({ name: current.name, version: current.version, integrity, tarballUrl: tarball, local });
    current = null;
    integrity = null;
    tarball = null;
    inResolution = false;
  };
  for (const line of text.split(/\r?\n/)) {
    if (/^[A-Za-z0-9].*:\s*$/.test(line)) {
      flush();
      section = line.slice(0, -1).trim();
      continue;
    }
    if (section !== "packages") continue;
    const key = /^ {2}(?! )(.+):\s*$/.exec(line);
    if (key?.[1]) {
      flush();
      current = parsePnpmKey(unquote(key[1]));
      continue;
    }
    if (!current) continue;
    if (/^ {4}resolution:/.test(line)) {
      inResolution = true;
    }
    if (inResolution || line.includes("integrity:") || line.includes("tarball:")) {
      const integrityMatch = /integrity:\s*(sha[0-9]+-[A-Za-z0-9+/=]+)/.exec(line);
      if (integrityMatch?.[1]) integrity = integrityMatch[1];
      const tarballMatch = /tarball:\s*([^\s,}]+)/.exec(line);
      if (tarballMatch?.[1]) tarball = unquote(tarballMatch[1]);
      if (line.includes("}") || (/^ {4}\S/.test(line) && !line.includes("resolution"))) {
        inResolution = false;
      }
    }
  }
  flush();
  return records;
}

function walkNpmDependencies(node: unknown, records: LockfilePackageRecord[]): void {
  if (!node || typeof node !== "object") return;
  const dependencies = (node as { dependencies?: unknown }).dependencies;
  if (!dependencies || typeof dependencies !== "object") return;
  for (const [name, value] of Object.entries(dependencies)) {
    if (!value || typeof value !== "object") continue;
    const entry = value as {
      version?: unknown;
      resolved?: unknown;
      integrity?: unknown;
      bundled?: unknown;
      dependencies?: unknown;
    };
    const version = typeof entry.version === "string" ? entry.version : "";
    const resolved = typeof entry.resolved === "string" ? entry.resolved : null;
    const integrity = typeof entry.integrity === "string" ? entry.integrity : null;
    const local = resolved !== null && /^(file:|link:)/.test(resolved);
    if (version) records.push({ name, version, integrity, tarballUrl: resolved, local });
    walkNpmDependencies(entry, records);
  }
}

function parseNpmLock(text: string): LockfilePackageRecord[] {
  const parsed: unknown = JSON.parse(text);
  const records: LockfilePackageRecord[] = [];
  if (parsed && typeof parsed === "object" && "packages" in parsed) {
    const packages = (parsed as { packages?: unknown }).packages;
    if (packages && typeof packages === "object") {
      for (const [key, value] of Object.entries(packages)) {
        if (!key || !value || typeof value !== "object") continue;
        const entry = value as {
          name?: unknown;
          version?: unknown;
          resolved?: unknown;
          integrity?: unknown;
          link?: unknown;
        };
        if (entry.link === true) continue;
        const resolved = typeof entry.resolved === "string" ? entry.resolved : null;
        const local = resolved !== null && /^(file:|link:)/.test(resolved);
        const version = typeof entry.version === "string" ? entry.version : "";
        const name =
          typeof entry.name === "string"
            ? entry.name
            : key.replace(/^node_modules\//, "").replace(/\/node_modules\//g, "/");
        if (!version) continue;
        records.push({
          name,
          version,
          integrity: typeof entry.integrity === "string" ? entry.integrity : null,
          tarballUrl: resolved,
          local,
        });
      }
    }
  }
  walkNpmDependencies(parsed, records);
  return records;
}

function parseYarnLock(text: string): LockfilePackageRecord[] {
  const records: LockfilePackageRecord[] = [];
  let version = "";
  let integrity: string | null = null;
  let tarball: string | null = null;
  let name = "";
  const flush = (): void => {
    if (!name || !version) {
      version = "";
      integrity = null;
      tarball = null;
      name = "";
      return;
    }
    const local = tarball !== null && /^(file:|link:|workspace:|portal:)/.test(tarball);
    records.push({ name, version, integrity, tarballUrl: tarball, local });
    version = "";
    integrity = null;
    tarball = null;
    name = "";
  };
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      flush();
      const header = unquote(line.replace(/:\s*$/, ""));
      const selector = header.split(",")[0]?.trim() ?? header;
      const at = selector.startsWith("@") ? selector.indexOf("@", 1) : selector.indexOf("@");
      name = at > 0 ? selector.slice(0, at) : selector;
      continue;
    }
    const versionMatch = /^\s+version:?\s+["']?([^"'\s]+)["']?/.exec(line);
    if (versionMatch?.[1]) version = versionMatch[1];
    const integrityMatch = /^\s+(?:integrity|checksum):?\s+["']?(sha[0-9]+-[A-Za-z0-9+/=]+)["']?/.exec(line);
    if (integrityMatch?.[1]) integrity = integrityMatch[1];
    const resolvedMatch = /^\s+resolved:?\s+["']?([^"'\s]+)["']?/.exec(line);
    if (resolvedMatch?.[1] && /^[a-z]+:/i.test(resolvedMatch[1])) tarball = resolvedMatch[1];
    const resolutionMatch = /^\s+resolution:?\s+["']?([^"'\s]+)["']?/.exec(line);
    if (resolutionMatch?.[1] && /^https?:/i.test(resolutionMatch[1])) tarball = resolutionMatch[1];
  }
  flush();
  return records;
}

export function readLockfilePackages(lockfilePath: string): {
  manager: PackageManager;
  packages: readonly LockfilePackageRecord[];
} {
  const manager = managerForLockfile(lockfilePath);
  const text = fs.readFileSync(lockfilePath, "utf8");
  const packages =
    manager === "pnpm" ? parsePnpmLock(text) : manager === "npm" ? parseNpmLock(text) : parseYarnLock(text);
  return { manager, packages };
}

function isSha512(integrity: string | null): integrity is string {
  return typeof integrity === "string" && /^sha512-[A-Za-z0-9+/]+={0,2}$/.test(integrity);
}

export function tarballHostAllowed(tarballUrl: string, allowedHosts: readonly string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(tarballUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (parsed.username || parsed.password) return false;
  if (parsed.port !== "" && parsed.port !== "443") return false;
  const host = parsed.hostname.toLowerCase();
  return allowedHosts.some((allowed) => {
    const normalized = allowed.includes("://") ? allowed : `https://${allowed}`;
    try {
      return new URL(normalized).hostname.toLowerCase() === host;
    } catch {
      return allowed.toLowerCase() === host;
    }
  });
}

function digest(bytes: Buffer): string {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}

export function verifyLockfileIntegrity(
  lockfilePath: string,
  options: IntegrityCheckOptions = {},
): LockfileIntegrityReport {
  const allowedHosts = options.allowedHosts ?? [...DEFAULT_REGISTRY_HOSTS];
  const { manager, packages } = readLockfilePackages(lockfilePath);
  const failures: LockfileIntegrityFailure[] = [];
  const seen = new Set<string>();
  const unique: LockfilePackageRecord[] = [];
  for (const record of packages) {
    const id = `${record.name}@${record.version}:${record.tarballUrl ?? ""}`;
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(record);
    if (record.local) continue;
    if (record.tarballUrl && !tarballHostAllowed(record.tarballUrl, allowedHosts)) {
      failures.push({
        name: record.name,
        version: record.version,
        code: "rogue_tarball_url",
        detail: `${record.name}@${record.version} resolves to non-registry tarball ${record.tarballUrl}`,
      });
    }
    if (!isSha512(record.integrity)) {
      failures.push({
        name: record.name,
        version: record.version,
        code: "missing_sha512",
        detail: `${record.name}@${record.version} is missing a SHA-512 integrity digest`,
      });
      continue;
    }
    const bytes = options.bytesFor?.(record) ?? null;
    if (bytes && digest(bytes) !== record.integrity) {
      failures.push({
        name: record.name,
        version: record.version,
        code: "integrity_mismatch",
        detail: `${record.name}@${record.version} SHA-512 integrity does not match the tarball bytes`,
      });
    }
  }
  const report: LockfileIntegrityReport = {
    ok: failures.length === 0,
    lockfilePath,
    manager,
    packages: unique,
    failures,
  };
  if (!report.ok) throw new LockfileIntegrityError(failures);
  return report;
}
