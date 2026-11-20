import { randomUUID, timingSafeEqual } from "node:crypto";
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { LoopbackEndpoint } from "./types.js";

interface TrackedSession {
  kind: "streamable" | "sse";
  close(): Promise<void>;
  transport: StreamableHTTPServerTransport | SSEServerTransport;
}

export interface LoopbackBinding {
  endpoint: LoopbackEndpoint;
  close(): Promise<void>;
}

function bearerMatches(header: string | undefined, expected: string): boolean {
  const presented = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  const left = Buffer.from(presented);
  const right = Buffer.from(expected);
  if (left.length !== right.length) {
    timingSafeEqual(Buffer.alloc(32, 1), Buffer.alloc(32, 2));
    return false;
  }
  return timingSafeEqual(left, right);
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function isLoopbackAddress(remote: string | undefined): boolean {
  return remote === "127.0.0.1" || remote === "::ffff:127.0.0.1" || remote === "::1";
}

function hostAllowed(hostHeader: string | undefined): boolean {
  if (!hostHeader) return true;
  const host = hostHeader.slice(0, hostHeader.lastIndexOf(":") > -1 && !hostHeader.endsWith("]") ? hostHeader.lastIndexOf(":") : hostHeader.length);
  const bare = host.replace(/^\[|\]$/g, "");
  return bare === "127.0.0.1" || bare === "localhost";
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw new Error("request body too large");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

/**
 * Loopback-only HTTP listener. A bearer mismatch returns 401 and never reaches MCP.
 * Streamable HTTP is `/mcp`. Legacy SSE is `GET /sse` plus `POST /messages`.
 */
export async function bindLoopback(options: {
  bearerToken: string;
  port?: number;
  openProtocol: () => Promise<Server>;
  onAnomaly: () => void;
}): Promise<LoopbackBinding> {
  const sessions = new Map<string, TrackedSession>();
  const server = http.createServer((req, res) => {
    void handleRequest(req, res, sessions, options).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: "InternalServerError" });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("loopback listener did not bind a TCP port");
  }
  const port = address.port;
  return {
    endpoint: {
      host: "127.0.0.1",
      port,
      streamableUrl: `http://127.0.0.1:${port}/mcp`,
      sseUrl: `http://127.0.0.1:${port}/sse`,
    },
    close: async () => {
      const closing = [...sessions.values()].map((session) => session.close());
      sessions.clear();
      await Promise.all(closing);
      if (!server.listening) return;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  sessions: Map<string, TrackedSession>,
  options: {
    bearerToken: string;
    openProtocol: () => Promise<Server>;
    onAnomaly: () => void;
  },
): Promise<void> {
  if (!isLoopbackAddress(req.socket.remoteAddress) || !hostAllowed(headerValue(req.headers.host))) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }
  if (!bearerMatches(headerValue(req.headers.authorization), options.bearerToken)) {
    options.onAnomaly();
    sendJson(res, 401, { error: "Unauthorized" });
    return;
  }
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/mcp") {
    await handleStreamable(req, res, sessions, options.openProtocol);
    return;
  }
  if (url.pathname === "/sse" && req.method === "GET") {
    await handleSseOpen(res, sessions, options.openProtocol);
    return;
  }
  if (url.pathname === "/messages" && req.method === "POST") {
    await handleSseMessage(req, res, url, sessions);
    return;
  }
  sendJson(res, 404, { error: "NotFound" });
}

async function handleStreamable(
  req: IncomingMessage,
  res: ServerResponse,
  sessions: Map<string, TrackedSession>,
  openProtocol: () => Promise<Server>,
): Promise<void> {
  const sessionId = headerValue(req.headers["mcp-session-id"]);
  const existing = sessionId ? sessions.get(sessionId) : undefined;
  if (existing?.kind === "streamable" && existing.transport instanceof StreamableHTTPServerTransport) {
    const body = req.method === "POST" ? await readJson(req) : undefined;
    await existing.transport.handleRequest(req, res, body);
    return;
  }
  if (sessionId) {
    sendJson(res, 404, { error: "SessionNotFound" });
    return;
  }
  const body = req.method === "POST" ? await readJson(req) : undefined;
  if (req.method !== "POST" || !isInitializeRequest(body)) {
    sendJson(res, 400, { error: "BadRequest" });
    return;
  }
  const protocol = await openProtocol();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => {
      sessions.set(id, {
        kind: "streamable",
        transport,
        close: async () => {
          await transport.close();
          await protocol.close();
        },
      });
    },
  });
  await protocol.connect(transport);
  await transport.handleRequest(req, res, body);
}

async function handleSseOpen(
  res: ServerResponse,
  sessions: Map<string, TrackedSession>,
  openProtocol: () => Promise<Server>,
): Promise<void> {
  const protocol = await openProtocol();
  const transport = new SSEServerTransport("/messages", res);
  sessions.set(transport.sessionId, {
    kind: "sse",
    transport,
    close: async () => {
      await transport.close();
      await protocol.close();
    },
  });
  transport.onclose = () => {
    sessions.delete(transport.sessionId);
  };
  await protocol.connect(transport);
}

async function handleSseMessage(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  sessions: Map<string, TrackedSession>,
): Promise<void> {
  const sessionId = url.searchParams.get("sessionId") ?? undefined;
  const session = sessionId ? sessions.get(sessionId) : undefined;
  if (!session || session.kind !== "sse" || !(session.transport instanceof SSEServerTransport)) {
    sendJson(res, 404, { error: "SessionNotFound" });
    return;
  }
  await session.transport.handlePostMessage(req, res);
}
