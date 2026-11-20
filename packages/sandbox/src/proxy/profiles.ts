import net from "node:net";
import { domainToASCII } from "node:url";
import type {
  AllowedTestEndpoint,
  AttemptResourceLimits,
  NetworkPolicyProfile,
  WrappedVendorId,
} from "./types.js";

export const KERNEL_REGISTRY_HOSTS: readonly string[] = [
  "registry.npmjs.org",
  "registry.yarnpkg.com",
  "pypi.org",
  "files.pythonhosted.org",
  "pypi.python.org",
  "upload.pypi.org",
];

export const RESEARCHER_DOCUMENTATION_HOSTS: readonly string[] = [
  "developer.mozilla.org",
  "nodejs.org",
  "docs.python.org",
  "pypi.org",
  "files.pythonhosted.org",
  "registry.npmjs.org",
  "docs.npmjs.com",
  "github.com",
  "raw.githubusercontent.com",
  "objects.githubusercontent.com",
  "docs.github.com",
  "react.dev",
  "nextjs.org",
  "www.typescriptlang.org",
  "typescriptlang.org",
  "docs.anthropic.com",
  "platform.openai.com",
  "docs.stripe.com",
  "semver.org",
  "pnpm.io",
  "crates.io",
  "docs.rs",
  "pkg.go.dev",
  "learn.microsoft.com",
];

export const WRAPPED_VENDOR_HOSTS: Readonly<Record<WrappedVendorId, readonly string[]>> = {
  openai: ["api.openai.com"],
  chatgpt: ["chatgpt.com"],
  anthropic: ["api.anthropic.com"],
  github_copilot: ["api.githubcopilot.com"],
  cursor: ["api2.cursor.sh"],
  google: ["generativelanguage.googleapis.com"],
};

export const DEFAULT_ATTEMPT_LIMITS: Readonly<Record<NetworkPolicyProfile, AttemptResourceLimits>> =
  {
    coding_worker: {
      maxConcurrentTunnels: 1,
      maxResponseBytes: 1024 * 1024,
      connectTimeoutMs: 5_000,
      idleTimeoutMs: 5_000,
    },
    verifier_test: {
      maxConcurrentTunnels: 8,
      maxResponseBytes: 8 * 1024 * 1024,
      connectTimeoutMs: 10_000,
      idleTimeoutMs: 30_000,
    },
    kernel_installer: {
      maxConcurrentTunnels: 4,
      maxResponseBytes: 64 * 1024 * 1024,
      connectTimeoutMs: 15_000,
      idleTimeoutMs: 60_000,
    },
    researcher: {
      maxConcurrentTunnels: 4,
      maxResponseBytes: 5 * 1024 * 1024,
      connectTimeoutMs: 10_000,
      idleTimeoutMs: 30_000,
    },
    wrapped_vendor: {
      maxConcurrentTunnels: 4,
      maxResponseBytes: 16 * 1024 * 1024,
      connectTimeoutMs: 15_000,
      idleTimeoutMs: 60_000,
    },
  };

export interface ProfileAccessRequest {
  readonly profile: NetworkPolicyProfile;
  readonly hostname: string;
  readonly port: number;
  readonly method: string;
  readonly connect: boolean;
  readonly vendor?: WrappedVendorId;
  readonly allowedTestEndpoints: readonly AllowedTestEndpoint[];
  readonly documentationHosts: readonly string[];
  readonly corporateRegistries: readonly string[];
}

export interface ProfileAccessDecision {
  readonly allow: boolean;
  readonly status: number;
  readonly reason: string;
}

const ALLOW: ProfileAccessDecision = { allow: true, status: 200, reason: "allowlisted" };

export function normalizeHostname(value: string): string | undefined {
  let host = value.trim().toLowerCase();
  if (
    !host ||
    host.includes("://") ||
    host.includes("/") ||
    host.includes("@") ||
    host.includes("*")
  ) {
    return undefined;
  }
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  const suffix = host.startsWith(".");
  if (suffix) host = host.slice(1);
  if (host.endsWith(".")) host = host.replace(/\.+$/, "");
  if (!host) return undefined;
  if (!suffix && net.isIP(stripZone(host)) !== 0) return stripZone(host);
  const ascii = domainToASCII(host);
  if (!ascii || ascii.includes("..") || ascii.startsWith("-") || ascii.endsWith("-"))
    return undefined;
  if (suffix) {
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(ascii)) return undefined;
    return `.${ascii}`;
  }
  if (ascii.includes(" ") || ascii.includes(":")) return undefined;
  return ascii;
}

function stripZone(address: string): string {
  const zone = address.indexOf("%");
  return zone >= 0 ? address.slice(0, zone) : address;
}

export function hostMatches(hostname: string, rule: string): boolean {
  const host = normalizeHostname(hostname);
  const expected = normalizeHostname(rule);
  if (!host || !expected || host.startsWith(".")) return false;
  if (expected.startsWith(".")) {
    const base = expected.slice(1);
    return host === base || host.endsWith(expected);
  }
  return host === expected;
}

export function evaluateProfileAccess(request: ProfileAccessRequest): ProfileAccessDecision {
  const method = request.method.toUpperCase();
  if (
    request.profile === "researcher" &&
    !request.connect &&
    method !== "GET" &&
    method !== "HEAD"
  ) {
    return { allow: false, status: 405, reason: "researcher_read_only" };
  }
  if (request.profile === "coding_worker") {
    return { allow: false, status: 403, reason: "coding_worker_deny_all" };
  }
  const hostDecision = decideHost(request);
  if (!hostDecision.allow) return hostDecision;
  return decidePort(request);
}

export function vendorOwnsHost(vendor: WrappedVendorId | undefined, hostname: string): boolean {
  if (!vendor) return false;
  return WRAPPED_VENDOR_HOSTS[vendor].some((rule) => hostMatches(hostname, rule));
}

function decideHost(request: ProfileAccessRequest): ProfileAccessDecision {
  if (request.profile === "verifier_test") {
    const exact = request.allowedTestEndpoints.some(
      (endpoint) => hostMatches(request.hostname, endpoint.host) && endpoint.port === request.port,
    );
    if (exact) return ALLOW;
    const hostOnly = request.allowedTestEndpoints.some((endpoint) =>
      hostMatches(request.hostname, endpoint.host),
    );
    if (hostOnly) return { allow: false, status: 403, reason: "port_not_allowlisted" };
    return { allow: false, status: 403, reason: "host_not_allowlisted" };
  }
  if (request.profile === "wrapped_vendor") {
    if (!request.vendor) return { allow: false, status: 403, reason: "vendor_not_bound" };
    if (vendorOwnsHost(request.vendor, request.hostname)) return ALLOW;
    return { allow: false, status: 403, reason: "host_not_allowlisted" };
  }
  if (request.profile === "kernel_installer") {
    const hosts = [...KERNEL_REGISTRY_HOSTS, ...request.corporateRegistries];
    if (hosts.some((rule) => hostMatches(request.hostname, rule))) return ALLOW;
    return { allow: false, status: 403, reason: "host_not_allowlisted" };
  }
  if (request.profile === "researcher") {
    if (request.documentationHosts.some((rule) => hostMatches(request.hostname, rule)))
      return ALLOW;
    return { allow: false, status: 403, reason: "host_not_allowlisted" };
  }
  return { allow: false, status: 403, reason: "host_not_allowlisted" };
}

function decidePort(request: ProfileAccessRequest): ProfileAccessDecision {
  if (request.profile === "verifier_test") return ALLOW;
  const declared = request.allowedTestEndpoints.some(
    (endpoint) => hostMatches(request.hostname, endpoint.host) && endpoint.port === request.port,
  );
  if (declared) return ALLOW;
  if (request.connect) {
    return request.port === 443
      ? ALLOW
      : { allow: false, status: 403, reason: "port_not_allowlisted" };
  }
  if (request.port === 80 || request.port === 443) return ALLOW;
  return { allow: false, status: 403, reason: "port_not_allowlisted" };
}
