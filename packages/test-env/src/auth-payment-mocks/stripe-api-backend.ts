import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { closeServer, createLoopbackServer, listenLoopback, readBody, sendJson } from "./http-util.js";

const LIVE_KEY_MARKER = ["sk", "_live_"].join("");

export type StripeBackendMode = "stripe-mock" | "emulator";

export interface StripeBackend {
  readonly mode: StripeBackendMode;
  readonly baseUrl: string;
  readonly boundAddress: "127.0.0.1";
  readonly port: number;
  readonly pid: number | undefined;
  close(): Promise<void>;
}

export function resolveStripeMockBinary(explicit?: string): string | undefined {
  if (explicit && existsSync(explicit)) return explicit;
  const fromEnv = process.env.STRIPE_MOCK_BIN;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return undefined;
  const candidates = [
    join(localAppData, "EFHarness", "components", "stripe-mock", "stripe-mock.exe"),
    join(localAppData, "EFHarness", "components", "stripe-mock", "stripe-mock"),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

export function ephemeralWebhookSecret(): string {
  return `whsec_test_mock_${randomBytes(16).toString("hex")}`;
}

export function ephemeralTestSecretKey(): string {
  return `sk_test_${randomBytes(12).toString("hex")}`;
}

export async function startStripeBackend(options?: {
  readonly binaryPath?: string;
  readonly port?: number;
}): Promise<StripeBackend> {
  if (options?.binaryPath) {
    const spawned = await trySpawnStripeMock(options.binaryPath);
    if (spawned) return spawned;
  }
  return startEmulator(options?.port ?? 0);
}

async function startEmulator(port: number): Promise<StripeBackend> {
  const objects = new Map<string, StoredObject>();
  const server = createLoopbackServer();
  server.on("request", (req, res) => {
    void handleEmulator(req, res, objects).catch((error: unknown) => {
      if (res.headersSent) return;
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, 400, { error: { type: "invalid_request_error", message } });
    });
  });
  const bound = await listenLoopback(server, port);
  return {
    mode: "emulator",
    baseUrl: `http://127.0.0.1:${bound}`,
    boundAddress: "127.0.0.1",
    port: bound,
    pid: undefined,
    close: () => closeServer(server),
  };
}

interface StoredObject {
  readonly id: string;
  readonly object: string;
  readonly livemode: false;
  readonly [key: string]: unknown;
}

async function handleEmulator(
  req: IncomingMessage,
  res: ServerResponse,
  objects: Map<string, StoredObject>,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
    sendJson(res, 200, { object: "stripe_mock", livemode: false, emulator: true });
    return;
  }
  const auth = req.headers.authorization ?? "";
  if (auth.includes(LIVE_KEY_MARKER)) {
    sendJson(res, 401, {
      error: { type: "authentication_error", message: "live secret keys are refused by the local mock" },
    });
    return;
  }
  if (!auth.startsWith("Bearer sk_test_") && !auth.startsWith("Bearer rk_test_")) {
    sendJson(res, 401, { error: { type: "authentication_error", message: "test API key required" } });
    return;
  }
  const parts = url.pathname.split("/").filter((part) => part.length > 0);
  if (parts[0] !== "v1" || !parts[1]) {
    sendJson(res, 404, { error: { type: "invalid_request_error", message: "unknown route" } });
    return;
  }
  const resource = parts[1];
  const id = parts[2];
  const objectName = resource.endsWith("s") ? resource.slice(0, -1) : resource;
  if (req.method === "GET" && !id) {
    const data = [...objects.values()].filter((item) => item.object === objectName);
    sendJson(res, 200, { object: "list", data, has_more: false, url: `/v1/${resource}` });
    return;
  }
  if (req.method === "GET" && id) {
    const found = objects.get(id);
    if (!found || found.object !== objectName) {
      sendJson(res, 404, { error: { type: "invalid_request_error", message: `No such ${objectName}` } });
      return;
    }
    sendJson(res, 200, found);
    return;
  }
  if (req.method === "POST" && !id) {
    const raw = await readBody(req);
    let parsed: Record<string, unknown> = {};
    if (raw.length > 0) {
      if (raw.trim().startsWith("{")) {
        const json: unknown = JSON.parse(raw);
        if (typeof json !== "object" || json === null || Array.isArray(json)) {
          sendJson(res, 400, { error: { type: "invalid_request_error", message: "JSON object required" } });
          return;
        }
        parsed = json as Record<string, unknown>;
      } else {
        parsed = Object.fromEntries(new URLSearchParams(raw).entries());
      }
    }
    if (parsed.livemode === true || parsed.livemode === "true") {
      sendJson(res, 400, { error: { type: "invalid_request_error", message: "livemode true is refused" } });
      return;
    }
    if (typeof parsed.url === "string") {
      try {
        const target = new URL(parsed.url);
        const host = target.hostname.toLowerCase();
        const loopback = host === "127.0.0.1" || host === "localhost" || host.endsWith(".localhost");
        if (!loopback) {
          sendJson(res, 400, { error: { type: "invalid_request_error", message: "webhook url must be loopback" } });
          return;
        }
      } catch (error) {
        sendJson(res, 400, {
          error: { type: "invalid_request_error", message: error instanceof Error ? error.message : String(error) },
        });
        return;
      }
    }
    const createdId = `${prefixFor(objectName)}_${randomBytes(8).toString("hex")}`;
    const record: StoredObject = {
      ...parsed,
      id: createdId,
      object: objectName,
      livemode: false,
    };
    objects.set(createdId, record);
    sendJson(res, 200, record);
    return;
  }
  sendJson(res, 405, { error: { type: "invalid_request_error", message: "method not allowed" } });
}

function prefixFor(objectName: string): string {
  const prefixes: Readonly<Record<string, string>> = {
    payment_intent: "pi",
    charge: "ch",
    customer: "cus",
    refund: "re",
    event: "evt",
    webhook_endpoint: "we",
  };
  return prefixes[objectName] ?? "obj";
}

async function trySpawnStripeMock(binaryPath: string): Promise<StripeBackend | undefined> {
  const probe = createLoopbackServer();
  const port = await listenLoopback(probe, 0);
  await closeServer(probe);
  const httpsPort = port + 1;
  let child: ChildProcess;
  try {
    child = spawn(binaryPath, ["-http-port", String(port), "-https-port", String(httpsPort)], {
      windowsHide: true,
      stdio: "ignore",
    });
  } catch (error) {
    if (error instanceof Error) return undefined;
    throw error;
  }
  const ready = await waitForPort(port, child, 1_500);
  if (!ready) {
    child.kill();
    return undefined;
  }
  return {
    mode: "stripe-mock",
    baseUrl: `http://127.0.0.1:${port}`,
    boundAddress: "127.0.0.1",
    port,
    pid: child.pid,
    close: async () => {
      child.kill();
    },
  };
}

function waitForPort(port: number, child: ChildProcess, timeoutMs: number): Promise<boolean> {
  const started = Date.now();
  return new Promise((resolve) => {
    const tick = (): void => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve(false);
        return;
      }
      const socket = connect({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.end();
        resolve(true);
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - started > timeoutMs) resolve(false);
        else setTimeout(tick, 40);
      });
    };
    tick();
  });
}
