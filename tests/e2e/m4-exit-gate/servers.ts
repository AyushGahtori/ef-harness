import http from "node:http";
import type { AddressInfo } from "node:net";
import { wireProblems } from "./wire.js";

export interface MockCounts {
  oidc: number;
  responses: number;
  anthropic: number;
  openrouter: number;
  copilot: number;
  copilotComplete: number;
  cursor: number;
  trap: number;
}

export interface MockPlane {
  readonly origin: string;
  readonly counts: MockCounts;
  readonly rejectedWire: string[];
  close(): Promise<void>;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
    connection: "close",
  });
  res.end(payload);
}

export async function startMockPlane(): Promise<MockPlane> {
  const counts: MockCounts = {
    oidc: 0,
    responses: 0,
    anthropic: 0,
    openrouter: 0,
    copilot: 0,
    copilotComplete: 0,
    cursor: 0,
    trap: 0,
  };
  const rejectedWire: string[] = [];
  const server = http.createServer((req, res) => {
    void handle(req, res, counts, rejectedWire).catch((error: unknown) => {
      if (!res.headersSent) res.writeHead(500);
      res.end(error instanceof Error ? error.message : "mock error");
    });
  });
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("mock plane did not bind a port"));
        return;
      }
      resolve((address as AddressInfo).port);
    });
  });
  return {
    origin: `http://127.0.0.1:${port}`,
    counts,
    rejectedWire,
    close: () =>
      new Promise((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

async function handle(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  counts: MockCounts,
  rejectedWire: string[],
): Promise<void> {
  const path = (req.url ?? "/").split("?")[0] ?? "/";
  const body = await readBody(req);
  if (path === "/oauth/token") {
    counts.oidc += 1;
    sendJson(res, 200, { access_token: "refreshed-session", expires_in: 3600, token_type: "bearer" });
    return;
  }
  if (path === "/v1/responses") {
    counts.responses += 1;
    const parsed = parseObject(body);
    const problems = wireProblems(parsed);
    if (problems.length > 0) {
      rejectedWire.push(problems.join(","));
      sendJson(res, 400, { error: "wire", problems });
      return;
    }
    const thread = typeof parsed.thread_id === "string" ? parsed.thread_id : "";
    res.writeHead(200, { "content-type": "text/event-stream", connection: "close" });
    res.end(`data: ${JSON.stringify({ type: "response.completed", thread_id: thread })}\n\n`);
    return;
  }
  if (path === "/v1/messages") {
    counts.anthropic += 1;
    sendJson(res, 200, { id: "msg", usage: { input_tokens: 1, output_tokens: 1 } });
    return;
  }
  if (path === "/openrouter/chat") {
    counts.openrouter += 1;
    sendJson(res, 200, { id: "or" });
    return;
  }
  if (path === "/copilot/quota") {
    counts.copilot += 1;
    sendJson(res, 200, { remaining: 0, overageEnabled: true });
    return;
  }
  if (path === "/copilot/complete") {
    counts.copilotComplete += 1;
    sendJson(res, 200, { id: "complete" });
    return;
  }
  if (path === "/cursor/me") {
    counts.cursor += 1;
    sendJson(res, 401, { error: "key_expired" });
    return;
  }
  if (path === "/exfil") {
    counts.trap += 1;
    sendJson(res, 200, { ok: true });
    return;
  }
  sendJson(res, 404, { error: "not_found" });
}

function parseObject(body: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function closedPort(): Promise<number> {
  const server = http.createServer();
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("closed-port probe did not bind"));
        return;
      }
      resolve(address.port);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  return port;
}
