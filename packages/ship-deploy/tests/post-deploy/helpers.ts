import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Clock, DeployAdapter, ExternalEffectLedger, HostLogSample } from "../../src/post-deploy/index.js";
import { sha256 } from "../../src/post-deploy/index.js";

export const NEW_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
export const OLD_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const PREVIOUS_SHA = "cccccccccccccccccccccccccccccccccccccccc";

export function syntheticLiveKey(): string {
  return `${["sk", "_live_"].join("")}${"AB".repeat(8)}`;
}

export function createAutoAdvanceClock(start = 0): Clock {
  let current = start;
  return {
    now: () => current,
    async wait(ms: number, signal?: AbortSignal) {
      if (signal?.aborted) return;
      current += ms;
    },
  };
}

export function healthySample(line = ""): HostLogSample {
  return {
    requests: 100,
    fiveXx: 0,
    unhandledExceptions: 0,
    containerRestarts: 0,
    healthOk: true,
    logLines: line ? [line] : [],
  };
}

export function spikeSample(line = ""): HostLogSample {
  return {
    requests: 100,
    fiveXx: 40,
    unhandledExceptions: 0,
    containerRestarts: 0,
    healthOk: true,
    logLines: line ? [line] : ["db connection reset"],
  };
}

export interface MockMode {
  buildId: string;
  styleguideStatus: number;
  leakSource: boolean;
  stackTrace: boolean;
  buildIdVia: "json" | "header" | "meta";
  healthStatus: number;
  ordersBroken: boolean;
  missingCss: boolean;
  brokenImage: boolean;
  protectedStatus: number;
  flipTo: string | null;
  flipAfter: number;
}

export interface MockDeploy {
  readonly origin: string;
  readonly requests: { method: string; path: string }[];
  mode: MockMode;
  setBuildId(buildId: string): void;
  close(): Promise<void>;
}

export async function startMockDeploy(partial?: Partial<MockMode>): Promise<MockDeploy> {
  const mode: MockMode = {
    buildId: NEW_SHA,
    styleguideStatus: 404,
    leakSource: false,
    stackTrace: false,
    buildIdVia: "json",
    healthStatus: 200,
    ordersBroken: false,
    missingCss: false,
    brokenImage: false,
    protectedStatus: 401,
    flipTo: null,
    flipAfter: 0,
    ...partial,
  };
  const requests: { method: string; path: string }[] = [];
  let healthHits = 0;
  const server = createServer(async (req, res) => {
    const method = req.method ?? "GET";
    const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    requests.push({ method, path });
    await readBody(req);
    if (path === "/api/health") {
      healthHits += 1;
      if (mode.flipTo && healthHits > mode.flipAfter) mode.buildId = mode.flipTo;
      writeHealth(res, mode);
      return;
    }
    if (path === "/__styleguide") {
      send(res, mode.styleguideStatus, "text/plain", mode.styleguideStatus === 404 ? "missing" : "styleguide");
      return;
    }
    if (path === "/orders") {
      if (!mode.ordersBroken) {
        send(res, 401, "text/plain", "locked");
        return;
      }
      send(res, 200, "text/html; charset=utf-8", ordersHtml());
      return;
    }
    if (path === "/account") {
      const status = mode.protectedStatus;
      send(res, status, "text/plain", status === 200 ? "open" : "locked");
      return;
    }
    if (path === "/app.css") {
      send(
        res,
        mode.missingCss ? 404 : 200,
        "text/css",
        mode.missingCss ? "missing" : "@font-face{font-family:App;src:url(/font.woff2)}body{color:#111}",
      );
      return;
    }
    if (path === "/font.woff2") {
      send(res, 200, "font/woff2", "woff");
      return;
    }
    if (path === "/logo.png") {
      send(res, mode.brokenImage ? 404 : 200, "image/png", mode.brokenImage ? "missing" : "png");
      return;
    }
    if (path === "/api/webhooks/stripe") {
      if (method === "POST") {
        send(res, 204, "text/plain", "");
        return;
      }
      send(res, 405, "text/plain", "method");
      return;
    }
    if (path === "/") {
      send(res, 200, "text/html; charset=utf-8", homeHtml(mode));
      return;
    }
    send(res, 404, "text/plain", "missing");
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("mock deploy did not bind a port");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    mode,
    setBuildId(buildId: string) {
      mode.buildId = buildId;
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

export class RecordingLedger implements ExternalEffectLedger {
  readonly events: string[] = [];

  async plan(intent: Parameters<ExternalEffectLedger["plan"]>[0]) {
    this.events.push(`plan:${intent.approvalStatus}`);
    return {
      effectId: `eff-${this.events.length}`,
      canonicalPayloadHash: sha256(JSON.stringify(intent.canonicalPayload)),
    };
  }

  async markDispatched(effectId: string): Promise<void> {
    this.events.push(`dispatch:${effectId}`);
  }

  async markSucceeded(effectId: string): Promise<void> {
    this.events.push(`succeed:${effectId}`);
  }

  async markFailed(effectId: string): Promise<void> {
    this.events.push(`fail:${effectId}`);
  }
}

export class RecordingAdapter implements DeployAdapter {
  readonly calls: { env: string; previousDeploymentId: string; effectId: string }[] = [];

  constructor(private readonly onRollback: () => { deploymentId: string; liveUrl: string; buildId: string }) {}

  async rollback(env: Parameters<DeployAdapter["rollback"]>[0], previousDeploymentId: string, effectId: string) {
    this.calls.push({ env, previousDeploymentId, effectId });
    return this.onRollback();
  }
}

function writeHealth(res: ServerResponse, mode: MockMode): void {
  if (mode.healthStatus !== 200) {
    send(res, mode.healthStatus, "text/plain", "unavailable");
    return;
  }
  if (mode.buildIdVia === "header") {
    res.setHeader("x-ef-build-id", mode.buildId);
    send(res, 200, "application/json", JSON.stringify({ ok: true }));
    return;
  }
  if (mode.buildIdVia === "meta") {
    send(
      res,
      200,
      "text/html",
      `<!doctype html><html><head><meta name="ef-build-id" content="${mode.buildId}"><title>Kitchen</title></head><body><main data-app-shell></main></body></html>`,
    );
    return;
  }
  const body: Record<string, unknown> = { ok: true, buildId: mode.buildId };
  if (mode.stackTrace) {
    body.stack = "Error: boom\n    at health (app.js:1:1)";
  }
  send(res, 200, "application/json", JSON.stringify(body));
}

function homeHtml(mode: MockMode): string {
  const leak = mode.leakSource ? ' data-ef-source="src/App.tsx"' : "";
  return `<!doctype html><html><head><meta name="ef-build-id" content="${mode.buildId}"><title>Kitchen</title><link rel="stylesheet" href="/app.css"></head><body><main data-app-shell${leak}><h1>Kitchen</h1><img src="/logo.png" alt="Logo"><form action="https://api.stripe.com/v1/charges" method="post"></form><script src="https://js.stripe.com/v3"></script></main></body></html>`;
}

function ordersHtml(): string {
  return "<!doctype html><html><head><title>Orders</title></head><body><main data-app-shell><script>window.__orders()</script></main></body></html>";
}

function send(res: ServerResponse, status: number, contentType: string, body: string): void {
  res.writeHead(status, { "content-type": contentType, "cache-control": "no-store" });
  res.end(body);
}

async function readBody(req: IncomingMessage): Promise<void> {
  for await (const chunk of req) {
    if (chunk) continue;
  }
}
