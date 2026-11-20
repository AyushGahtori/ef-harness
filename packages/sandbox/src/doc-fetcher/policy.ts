import { isIP } from "node:net";
import { DomainNotAllowlistedError, DocMethodNotAllowedError, SsrfBlockedError } from "./errors.js";

export const DEFAULT_MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024;
export const DEFAULT_MAX_OUTPUT_BYTES = 32 * 1024;
export const MAX_REDIRECTS = 5;
export const MIN_STATIC_TEXT_CHARS = 200;
export const RESEARCH_CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const DOC_FETCH_USER_AGENT = "ef-harness-doc-fetcher/1";

export type DocFetchRole = "worker" | "researcher";

interface HostRule {
  readonly host: string;
  readonly subdomains: boolean;
  readonly pinnedGitCommit: boolean;
}

const WORKER_HOSTS: readonly HostRule[] = [
  { host: "nodejs.org", subdomains: true, pinnedGitCommit: false },
  { host: "react.dev", subdomains: true, pinnedGitCommit: false },
  { host: "reactjs.org", subdomains: true, pinnedGitCommit: false },
  { host: "nextjs.org", subdomains: true, pinnedGitCommit: false },
  { host: "vuejs.org", subdomains: true, pinnedGitCommit: false },
  { host: "vitejs.dev", subdomains: true, pinnedGitCommit: false },
  { host: "vite.dev", subdomains: true, pinnedGitCommit: false },
  { host: "typescriptlang.org", subdomains: true, pinnedGitCommit: false },
  { host: "python.org", subdomains: true, pinnedGitCommit: false },
  { host: "npmjs.com", subdomains: true, pinnedGitCommit: false },
  { host: "registry.npmjs.org", subdomains: true, pinnedGitCommit: false },
  { host: "pypi.org", subdomains: true, pinnedGitCommit: false },
  { host: "rust-lang.org", subdomains: true, pinnedGitCommit: false },
  { host: "go.dev", subdomains: true, pinnedGitCommit: false },
  { host: "golang.org", subdomains: true, pinnedGitCommit: false },
  { host: "deno.com", subdomains: true, pinnedGitCommit: false },
  { host: "bun.sh", subdomains: true, pinnedGitCommit: false },
  { host: "angular.dev", subdomains: true, pinnedGitCommit: false },
  { host: "svelte.dev", subdomains: true, pinnedGitCommit: false },
  { host: "docs.oracle.com", subdomains: true, pinnedGitCommit: false },
  { host: "github.com", subdomains: false, pinnedGitCommit: true },
  { host: "raw.githubusercontent.com", subdomains: false, pinnedGitCommit: true },
];

const RESEARCHER_EXTRA_HOSTS: readonly HostRule[] = [
  { host: "developer.mozilla.org", subdomains: true, pinnedGitCommit: false },
  { host: "learn.microsoft.com", subdomains: true, pinnedGitCommit: false },
  { host: "docs.microsoft.com", subdomains: true, pinnedGitCommit: false },
  { host: "developer.apple.com", subdomains: true, pinnedGitCommit: false },
  { host: "developer.android.com", subdomains: true, pinnedGitCommit: false },
  { host: "developer.chrome.com", subdomains: true, pinnedGitCommit: false },
  { host: "web.dev", subdomains: true, pinnedGitCommit: false },
  { host: "pkg.go.dev", subdomains: false, pinnedGitCommit: false },
  { host: "docs.rs", subdomains: true, pinnedGitCommit: false },
  { host: "crates.io", subdomains: true, pinnedGitCommit: false },
  { host: "rfc-editor.org", subdomains: true, pinnedGitCommit: false },
  { host: "man7.org", subdomains: true, pinnedGitCommit: false },
  { host: "kubernetes.io", subdomains: true, pinnedGitCommit: false },
  { host: "docs.docker.com", subdomains: true, pinnedGitCommit: false },
  { host: "docs.github.com", subdomains: true, pinnedGitCommit: false },
  { host: "cloud.google.com", subdomains: true, pinnedGitCommit: false },
  { host: "docs.aws.amazon.com", subdomains: true, pinnedGitCommit: false },
  { host: "nuget.org", subdomains: true, pinnedGitCommit: false },
  { host: "hex.pm", subdomains: true, pinnedGitCommit: false },
  { host: "hexdocs.pm", subdomains: true, pinnedGitCommit: false },
  { host: "rubygems.org", subdomains: true, pinnedGitCommit: false },
  { host: "rubyonrails.org", subdomains: true, pinnedGitCommit: false },
  { host: "php.net", subdomains: true, pinnedGitCommit: false },
  { host: "cppreference.com", subdomains: true, pinnedGitCommit: false },
  { host: "readthedocs.io", subdomains: true, pinnedGitCommit: false },
  { host: "readthedocs.org", subdomains: true, pinnedGitCommit: false },
  { host: "postgresql.org", subdomains: true, pinnedGitCommit: false },
  { host: "redis.io", subdomains: true, pinnedGitCommit: false },
  { host: "prisma.io", subdomains: true, pinnedGitCommit: false },
  { host: "tailwindcss.com", subdomains: true, pinnedGitCommit: false },
  { host: "electronjs.org", subdomains: true, pinnedGitCommit: false },
];

export const DOC_DOMAIN_ALLOWLIST: readonly string[] = WORKER_HOSTS.map((rule) => rule.host);

export const RESEARCHER_DOC_DOMAIN_ALLOWLIST: readonly string[] = [
  ...DOC_DOMAIN_ALLOWLIST,
  ...RESEARCHER_EXTRA_HOSTS.map((rule) => rule.host),
];

const COMMIT_SHA = /^[0-9a-f]{40}$/i;

export function assertReadOnlyMethod(method: string): asserts method is "GET" | "HEAD" {
  if (method !== "GET" && method !== "HEAD") throw new DocMethodNotAllowedError(method);
}

export function isGithubHost(hostname: string): boolean {
  const host = normalizeHost(hostname);
  return host === "github.com" || host === "raw.githubusercontent.com";
}

export function githubCommitPinned(url: URL): boolean {
  const host = normalizeHost(url.hostname);
  const parts = url.pathname.split("/").filter((part) => part.length > 0);
  if (host === "github.com") {
    const kind = parts[2]?.toLowerCase();
    const sha = parts[3] ?? "";
    return (
      parts.length >= 4 &&
      (kind === "blob" || kind === "tree" || kind === "raw" || kind === "commit") &&
      COMMIT_SHA.test(sha)
    );
  }
  if (host === "raw.githubusercontent.com") {
    const sha = parts[2] ?? "";
    return parts.length >= 4 && COMMIT_SHA.test(sha);
  }
  return false;
}

export function isDocHostAllowed(hostname: string, role: DocFetchRole): boolean {
  const host = normalizeHost(hostname);
  const rules = role === "researcher" ? [...WORKER_HOSTS, ...RESEARCHER_EXTRA_HOSTS] : WORKER_HOSTS;
  return rules.some((rule) => hostMatches(host, rule));
}

export interface DocUrlPolicy {
  readonly role: DocFetchRole;
  readonly testOnlyLoopbackOverride: boolean;
  readonly testAllowedHosts: readonly string[];
}

export function assertDocUrlAllowed(url: URL, policy: DocUrlPolicy): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new DomainNotAllowlistedError(url.hostname || url.protocol);
  }
  if (url.username !== "" || url.password !== "") throw new SsrfBlockedError(url.hostname);
  const hostname = normalizeHost(url.hostname);
  if (isAmbiguousIp(hostname) || isIpLiteral(hostname)) {
    if (isBlockedAddress(hostname, { allowLoopbackFixture: false })) throw new SsrfBlockedError(hostname);
  }
  if (!hostAllowed(hostname, url, policy)) throw new DomainNotAllowlistedError(hostname);
}

export function hostAllowed(hostname: string, url: URL, policy: DocUrlPolicy): boolean {
  const host = normalizeHost(hostname);
  if (policy.testOnlyLoopbackOverride) {
    for (const allowed of policy.testAllowedHosts) {
      if (host === normalizeHost(allowed)) return true;
    }
  }
  if (!isDocHostAllowed(host, policy.role)) return false;
  if (isGithubHost(host) && !githubCommitPinned(url)) return false;
  return true;
}

export function isIpLiteral(hostname: string): boolean {
  return isIP(normalizeHost(hostname)) !== 0;
}

export function isAmbiguousIp(hostname: string): boolean {
  const host = normalizeHost(hostname);
  if (/^0x[0-9a-f]+$/i.test(host)) return true;
  if (/^\d+$/.test(host)) return true;
  if (/^\d+(?:\.\d+){1,2}$/.test(host)) return true;
  const parts = host.split(".");
  if (parts.length === 4 && parts.some((part) => part.length > 1 && part.startsWith("0"))) return true;
  return false;
}

export function isBlockedAddress(address: string, options: { readonly allowLoopbackFixture: boolean }): boolean {
  const normalized = normalizeHost(address).split("%")[0] ?? "";
  const mapped = ipv4FromMapped(normalized);
  if (mapped) return isBlockedV4(mapped, options.allowLoopbackFixture);
  if (isIPv4(normalized)) return isBlockedV4(normalized, options.allowLoopbackFixture);
  if (isIP(normalized) === 6) return isBlockedV6(normalized, options.allowLoopbackFixture);
  return true;
}

export function normalizeHost(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, "");
}

function hostMatches(hostname: string, rule: HostRule): boolean {
  if (hostname === rule.host) return true;
  return rule.subdomains && hostname.endsWith(`.${rule.host}`);
}

function isIPv4(address: string): boolean {
  return ipv4ToInt(address) !== null;
}

function ipv4ToInt(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    if (part.length > 1 && part.startsWith("0")) return null;
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

function isBlockedV4(address: string, allowLoopbackFixture: boolean): boolean {
  const value = ipv4ToInt(address);
  if (value === null) return true;
  const contains = (base: string, bits: number): boolean => {
    const start = ipv4ToInt(base);
    if (start === null) return false;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) === (start & mask);
  };
  if (contains("127.0.0.0", 8)) return !allowLoopbackFixture;
  if (contains("0.0.0.0", 8)) return true;
  if (contains("10.0.0.0", 8)) return true;
  if (contains("100.64.0.0", 10)) return true;
  if (contains("172.16.0.0", 12)) return true;
  if (contains("192.168.0.0", 16)) return true;
  if (contains("169.254.0.0", 16)) return true;
  if (contains("224.0.0.0", 4)) return true;
  return false;
}

function isBlockedV6(address: string, allowLoopbackFixture: boolean): boolean {
  const hextets = expandIPv6(address);
  if (!hextets) return true;
  const mapped = hextetsToMappedV4(hextets);
  if (mapped) return isBlockedV4(mapped, allowLoopbackFixture);
  const loopback = hextets.slice(0, 7).every((part) => part === 0) && hextets[7] === 1;
  if (loopback) return !allowLoopbackFixture;
  if (hextets.every((part) => part === 0)) return true;
  const first = hextets[0] ?? 0;
  if ((first & 0xfe00) === 0xfc00) return true;
  if ((first & 0xffc0) === 0xfe80) return true;
  if ((first & 0xff00) === 0xff00) return true;
  return false;
}

function ipv4FromMapped(address: string): string | null {
  if (!address.includes(":")) return null;
  const hextets = expandIPv6(address);
  if (!hextets) return null;
  return hextetsToMappedV4(hextets);
}

function hextetsToMappedV4(hextets: readonly number[]): string | null {
  const prefix = hextets.slice(0, 5).every((part) => part === 0) && hextets[5] === 0xffff;
  if (!prefix) return null;
  const hi = hextets[6] ?? 0;
  const lo = hextets[7] ?? 0;
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

function expandIPv6(address: string): number[] | null {
  let zone = address.toLowerCase().split("%")[0] ?? "";
  if (zone.includes(".")) {
    const lastColon = zone.lastIndexOf(":");
    if (lastColon < 0) return null;
    const v4 = ipv4ToInt(zone.slice(lastColon + 1));
    if (v4 === null) return null;
    const hi = ((v4 >>> 16) & 0xffff).toString(16);
    const lo = (v4 & 0xffff).toString(16);
    zone = `${zone.slice(0, lastColon)}:${hi}:${lo}`;
  }
  const halves = zone.split("::");
  if (halves.length > 2) return null;
  const parseSide = (side: string | undefined): string[] | null => {
    if (!side) return [];
    const pieces = side.split(":");
    if (pieces.some((piece) => piece.length === 0)) return null;
    return pieces;
  };
  if (halves.length === 1) {
    const parts = parseSide(halves[0]);
    if (!parts || parts.length !== 8) return null;
    return parseHextets(parts);
  }
  const left = parseSide(halves[0]);
  const right = parseSide(halves[1]);
  if (!left || !right) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 0) return null;
  return parseHextets([...left, ...Array<string>(missing).fill("0"), ...right]);
}

function parseHextets(parts: readonly string[]): number[] | null {
  if (parts.length !== 8) return null;
  const out: number[] = [];
  for (const part of parts) {
    if (!/^[0-9a-f]{1,4}$/i.test(part)) return null;
    out.push(Number.parseInt(part, 16));
  }
  return out;
}

export function toVersionRange(version: string): string {
  const core = version.split("-")[0] ?? version;
  const parts = core.split(".");
  const major = parts[0];
  const minor = parts[1];
  if (major && minor && /^\d+$/.test(major) && /^\d+$/.test(minor)) return `${major}.${minor}`;
  if (major && /^\d+$/.test(major) && parts.length === 1) return major;
  return "unknown";
}

const PACKAGE_SPEC =
  /^(?<name>@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)@(?<version>\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?)$/i;

export function parsePackageSpec(value: string): { name: string; version: string } | null {
  const match = PACKAGE_SPEC.exec(value.trim());
  const name = match?.groups?.name;
  const version = match?.groups?.version;
  if (!name || !version) return null;
  return { name, version };
}

export function registryDocUrl(name: string, version: string, ecosystem: "npm" | "pypi"): string {
  if (ecosystem === "pypi") {
    return `https://pypi.org/pypi/${encodeURIComponent(name)}/${encodeURIComponent(version)}/json`;
  }
  return `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`;
}
