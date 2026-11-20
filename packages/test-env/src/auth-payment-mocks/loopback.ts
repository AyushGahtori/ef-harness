import { NonLoopbackTargetError } from "./errors.js";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);

export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (LOOPBACK_HOSTS.has(host)) return true;
  return host.endsWith(".localhost");
}

export function assertLoopbackHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new NonLoopbackTargetError(raw);
  }
  if (url.protocol !== "http:") {
    throw new NonLoopbackTargetError(raw);
  }
  if (url.username !== "" || url.password !== "") {
    throw new NonLoopbackTargetError(raw);
  }
  if (!isLoopbackHostname(url.hostname)) {
    throw new NonLoopbackTargetError(raw);
  }
  return url;
}

export function assertLoopbackRedirectUri(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RedirectUriProblem(raw, "unparseable");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new RedirectUriProblem(raw, "scheme");
  }
  if (url.username !== "" || url.password !== "" || url.hash !== "") {
    throw new RedirectUriProblem(raw, "userinfo-or-fragment");
  }
  if (!isLoopbackHostname(url.hostname)) {
    throw new RedirectUriProblem(raw, "not-loopback");
  }
}

class RedirectUriProblem extends Error {
  readonly redirectUri: string;

  constructor(redirectUri: string, reason: string) {
    super(`${reason}:${redirectUri}`);
    this.name = "RedirectUriProblem";
    this.redirectUri = redirectUri;
  }
}

export function redirectRejectionReason(error: unknown): string | undefined {
  if (error instanceof RedirectUriProblem) {
    const splitAt = error.message.indexOf(":");
    return splitAt === -1 ? error.message : error.message.slice(0, splitAt);
  }
  return undefined;
}
