import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { CALLBACK_PATH } from "./constants.js";
import { SiwcCallbackTimeoutError, SiwcCancelledError, SiwcInvalidStateError } from "./errors.js";
import { timingSafeEqualString } from "./pkce.js";

export interface LoopbackCallback {
  readonly code: string;
  readonly state: string;
  readonly clientId: string | null;
  readonly error: string | null;
  readonly scope: string | null;
}

export interface LoopbackListener {
  readonly port: number;
  arm(expectedState: string, ttlMs: number): Promise<LoopbackCallback>;
  cancel(): void;
  close(): Promise<void>;
}

export async function openLoopback(): Promise<LoopbackListener> {
  let settle: ((value: LoopbackCallback) => void) | null = null;
  let rejectWait: ((error: Error) => void) | null = null;
  let expectedState = "";
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const finish = (fn: () => void) => {
    if (settled) return;
    settled = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    fn();
  };

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = parseRequestUrl(req);
    if (!url || url.pathname !== CALLBACK_PATH) {
      respond(res, 404, "Not found");
      return;
    }
    const state = url.searchParams.get("state") ?? "";
    if (!expectedState || !timingSafeEqualString(state, expectedState)) {
      respond(res, 400, "Invalid state", () => {
        finish(() => rejectWait?.(new SiwcInvalidStateError()));
      });
      return;
    }
    const callback: LoopbackCallback = {
      code: url.searchParams.get("code") ?? "",
      state,
      clientId: url.searchParams.get("client_id"),
      error: url.searchParams.get("error"),
      scope: url.searchParams.get("scope"),
    };
    respond(res, 200, "<!doctype html><title>Signed in</title><p>You can close this window.</p>", () => {
      finish(() => settle?.(callback));
    });
  });

  await listen(server);
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Loopback listener did not bind a TCP port");
  }
  const port = address.port;

  const close = () => new Promise<void>((resolve) => {
    if (closed) {
      resolve();
      return;
    }
    closed = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    server.close(() => resolve());
  });

  return {
    port,
    arm(state: string, ttlMs: number) {
      expectedState = state;
      settled = false;
      return new Promise((resolvePromise, rejectPromise) => {
        settle = resolvePromise;
        rejectWait = rejectPromise;
        timer = setTimeout(() => {
          finish(() => rejectPromise(new SiwcCallbackTimeoutError()));
          void close();
        }, ttlMs);
        timer.unref();
      });
    },
    cancel() {
      finish(() => rejectWait?.(new SiwcCancelledError()));
      void close();
    },
    close,
  };
}

function parseRequestUrl(req: IncomingMessage): URL | null {
  try {
    return new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
  } catch {
    return null;
  }
}

function respond(res: ServerResponse, status: number, body: string, after?: () => void): void {
  if (after) res.once("finish", after);
  res.writeHead(status, {
    "content-type": status === 200 ? "text/html; charset=utf-8" : "text/plain; charset=utf-8",
    connection: "close",
  });
  res.end(body);
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
}
