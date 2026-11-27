import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

const HARD_CODED_APP_PORT = 3000;
const HARD_CODED_APP_PORT_WAIT_MS = 4_000;

export function listenLoopback(server: Server, port: number): Promise<number> {
  const deadline = port === HARD_CODED_APP_PORT ? Date.now() + HARD_CODED_APP_PORT_WAIT_MS : 0;
  return bindLoopback(server, port, deadline);
}

function bindLoopback(server: Server, port: number, deadline: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException): void => {
      server.off("listening", onListening);
      if (error.code === "EADDRINUSE" && port === HARD_CODED_APP_PORT && Date.now() < deadline) {
        setTimeout(() => {
          bindLoopback(server, port, deadline).then(resolve, reject);
        }, 20);
        return;
      }
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("expected a TCP listening address"));
        return;
      }
      if (address.address !== "127.0.0.1") {
        reject(new Error(`refusing non-loopback bind ${address.address}`));
        return;
      }
      resolve(address.port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

export function closeServer(server: Server): Promise<void> {
  if (typeof server.closeAllConnections === "function") {
    server.closeAllConnections();
  }
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export function readBody(req: IncomingMessage, limit = 1_000_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("request body exceeds 1 MB"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("error", reject);
    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
}

export interface JsonResponse {
  readonly status: number;
  readonly json: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

export function sendJson(res: ServerResponse, status: number, json: unknown, extra?: Readonly<Record<string, string>>): void {
  const body = JSON.stringify(json);
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": String(Buffer.byteLength(body)),
  };
  if (extra) {
    for (const [key, value] of Object.entries(extra)) headers[key] = value;
  }
  res.writeHead(status, headers);
  res.end(body);
}

export function sendRedirect(res: ServerResponse, location: string): void {
  res.writeHead(302, {
    location,
    "cache-control": "no-store",
    "content-length": "0",
  });
  res.end();
}

export function createLoopbackServer(): Server {
  return createServer();
}
