import { HttpDowngradeError, StrictTlsDisabledError } from "./errors.js";

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

/**
 * HTTPS stays on the platform trust store.
 * Plain HTTP is allowed only for loopback tests. An HTTPS URL must not fall back to HTTP.
 * This module never assigns NODE_TLS_REJECT_UNAUTHORIZED.
 */
export function assertDownloadUrlAllowed(url: string, primaryUrl: string): void {
  let target: URL;
  let primary: URL;
  try {
    target = new URL(url);
    primary = new URL(primaryUrl);
  } catch (error) {
    void error;
    throw new HttpDowngradeError(`Refusing non-absolute URL ${url}`);
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    throw new HttpDowngradeError(`Refusing ${target.protocol} URL ${url}`);
  }
  if (target.protocol === "http:" && primary.protocol === "https:") {
    throw new HttpDowngradeError(`Refusing HTTP downgrade from ${primaryUrl} to ${url}`);
  }
  if (target.protocol === "http:" && !isLoopbackHost(target.hostname)) {
    throw new HttpDowngradeError(`Refusing non-loopback HTTP URL ${url}`);
  }
}

export function assertStrictTlsEnabled(env: NodeJS.ProcessEnv): void {
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
    throw new StrictTlsDisabledError();
  }
}
