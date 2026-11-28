import { LOOPBACK_HOSTS, type LoopbackHost } from "./constants.js";
import { OpenRouterLocalError } from "./errors.js";

export interface DiscoveryTarget {
  readonly origin: string;
  readonly host: LoopbackHost | string;
  readonly port: number;
  readonly loopback: boolean;
}

export function isLoopbackHost(host: string): host is LoopbackHost {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return (LOOPBACK_HOSTS as readonly string[]).includes(normalized);
}

/**
 * Automatic discovery may call only `127.0.0.1` or `localhost`.
 * A LAN host is accepted only after an explicit Settings opt-in.
 */
export function assertDiscoveryUrl(raw: string, allowLanHost: boolean): DiscoveryTarget {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new OpenRouterLocalError("loopback-required", "local discovery URL is not a URL");
  }
  if (url.username !== "" || url.password !== "") {
    throw new OpenRouterLocalError("loopback-required", "local discovery URL cannot carry credentials");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new OpenRouterLocalError("loopback-required", "local discovery URL must be http or https");
  }
  const host = url.hostname.toLowerCase();
  const loopback = isLoopbackHost(host);
  if (!loopback && !allowLanHost) {
    throw new OpenRouterLocalError(
      "loopback-required",
      "automatic local discovery probes only 127.0.0.1 or localhost",
    );
  }
  if (!loopback && (host === "0.0.0.0" || host === "::" || host.includes("*"))) {
    throw new OpenRouterLocalError("loopback-required", "local discovery cannot bind a wildcard host");
  }
  const port = url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new OpenRouterLocalError("loopback-required", "local discovery port is out of range");
  }
  const origin = `${url.protocol}//${url.host}`;
  return { origin, host, port, loopback };
}

export function loopbackOrigin(host: string, port: number, allowLanHost: boolean): string {
  const target = assertDiscoveryUrl(`http://${host}:${port}/`, allowLanHost);
  return target.origin;
}
