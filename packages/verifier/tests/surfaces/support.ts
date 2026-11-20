import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { SurfaceVerifierContext } from "../../src/surfaces/types.js";

export async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string | number | readonly string[]> = {},
): void {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify(body));
}

export async function listen(
  handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>,
): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer((request, response) => {
    void Promise.resolve(handler(request, response)).catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

export function verifierContext(appUrl: string, tier: 0 | 1 | 2 | 3 = 3): SurfaceVerifierContext {
  return {
    env: {
      id: "env-063",
      tier,
      vars: () => ({ APP_URL: appUrl }),
    },
    attemptId: "attempt-063",
    checkVersion: 1,
    artifactDigest: "digest-063",
    recordedAt: 1_700_000_000_000,
  };
}
