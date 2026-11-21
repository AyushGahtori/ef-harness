import { createRequire } from "node:module";
import { ZeroNetworkDeniedError } from "./errors.js";

const require = createRequire(import.meta.url);

export function installZeroNetworkGuard(): void {
  const deny = (): never => {
    throw new ZeroNetworkDeniedError();
  };
  const net = require("node:net") as Record<string, unknown>;
  net.connect = deny;
  net.createConnection = deny;
  const socket = net.Socket;
  if (typeof socket === "function" && socket.prototype && typeof socket.prototype === "object") {
    (socket.prototype as { connect: unknown }).connect = deny;
  }
  const dns = require("node:dns") as Record<string, unknown>;
  const denyLookup = (_host: unknown, optionsOrCallback?: unknown, maybeCallback?: unknown): void => {
    const callback = typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback;
    const error = new ZeroNetworkDeniedError();
    if (typeof callback === "function") {
      callback(error);
      return;
    }
    throw error;
  };
  dns.lookup = denyLookup;
  dns.resolve = denyLookup;
  dns.resolve4 = denyLookup;
  dns.resolve6 = denyLookup;
  const http = require("node:http") as Record<string, unknown>;
  const https = require("node:https") as Record<string, unknown>;
  http.request = deny;
  http.get = deny;
  https.request = deny;
  https.get = deny;
  globalThis.fetch = (async () => {
    throw new ZeroNetworkDeniedError();
  }) as typeof fetch;
}

export function networkIsDenied(): boolean {
  try {
    const net = require("node:net") as { connect: (options: { host: string; port: number }) => { destroy?: () => void } };
    const socket = net.connect({ host: "127.0.0.1", port: 9 });
    socket.destroy?.();
    return false;
  } catch {
    return true;
  }
}
