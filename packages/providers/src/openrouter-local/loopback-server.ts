import { createServer, type Server } from "node:http";
import { OpenRouterLocalError } from "./errors.js";

export type LoopbackCallback =
  | { readonly status: "code"; readonly code: string }
  | { readonly status: "cancelled"; readonly error: string };

interface Deferred<T> {
  done: boolean;
  readonly promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolveFn: (value: T) => void = () => undefined;
  let done = false;
  const promise = new Promise<T>((resolve) => {
    resolveFn = (value) => {
      if (done) return;
      done = true;
      resolve(value);
    };
  });
  return {
    get done() {
      return done;
    },
    promise,
    resolve: resolveFn,
  };
}

function isLoopbackPeer(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::ffff:127.0.0.1" || address === "::1";
}

/**
 * Ephemeral PKCE callback bound only to 127.0.0.1. The system browser is the
 * only UI; this listener never renders a password form.
 */
export class LoopbackCallbackServer {
  readonly callbackUrl: string;
  private readonly pending: Deferred<LoopbackCallback>;

  private constructor(
    private readonly server: Server,
    readonly port: number,
    pending: Deferred<LoopbackCallback>,
  ) {
    this.callbackUrl = `http://127.0.0.1:${port}/callback`;
    this.pending = pending;
  }

  static async listen(): Promise<LoopbackCallbackServer> {
    const pending = deferred<LoopbackCallback>();
    const server = createServer((request, response) => {
      const remote = request.socket.remoteAddress;
      if (!isLoopbackPeer(remote)) {
        response.statusCode = 403;
        response.end();
        return;
      }
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        response.statusCode = 404;
        response.end();
        return;
      }
      response.statusCode = 200;
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end("<!doctype html><title>OpenRouter</title><p>You can close this window.</p>");
      const code = url.searchParams.get("code");
      if (code !== null && code.trim().length > 0) {
        pending.resolve({ status: "code", code: code.trim() });
        return;
      }
      pending.resolve({
        status: "cancelled",
        error: url.searchParams.get("error") ?? "missing_code",
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      server.close();
      throw new OpenRouterLocalError("loopback", "loopback listener has no TCP port");
    }
    return new LoopbackCallbackServer(server, address.port, pending);
  }

  wait(timeoutMs: number, signal?: AbortSignal): Promise<LoopbackCallback> {
    if (signal?.aborted) return Promise.resolve({ status: "cancelled", error: "cancelled" });
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.resolve({ status: "cancelled", error: "timeout" });
      }, timeoutMs);
      const onAbort = (): void => {
        this.pending.resolve({ status: "cancelled", error: "cancelled" });
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      void this.pending.promise.then((value) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(value);
      });
    });
  }

  async close(): Promise<void> {
    if (!this.server.listening) return;
    if (typeof this.server.closeAllConnections === "function") {
      this.server.closeAllConnections();
    }
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}
