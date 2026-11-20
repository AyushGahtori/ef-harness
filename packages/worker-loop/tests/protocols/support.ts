import http from "node:http";
import type {
  AdapterCallOptions,
  ModelProfile,
  ModelTurnRequest,
  StreamEvent,
} from "../../src/protocols/index.js";
import { createDefaultModelProfileRegistry } from "../../src/protocols/index.js";

export function profiles(): Record<string, ModelProfile> {
  const registry = createDefaultModelProfileRegistry();
  return Object.fromEntries(registry.list().map((profile) => [profile.id, profile]));
}

export function request(overrides: {
  readonly model: string;
  readonly profile: ModelProfile;
  readonly route: ModelTurnRequest["route"];
  readonly messages?: ModelTurnRequest["messages"];
  readonly tools?: ModelTurnRequest["tools"];
  readonly replayItems?: ModelTurnRequest["replayItems"];
  readonly reservedOutputTokens?: number;
  readonly clientRequestId?: string;
  readonly idempotencyKey?: string;
  readonly prefix?: ModelTurnRequest["prefix"];
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
  readonly previousResponseId?: string;
  readonly store?: boolean;
  readonly responseSchema?: ModelTurnRequest["responseSchema"];
  readonly includeEncryptedReasoning?: boolean;
}): ModelTurnRequest {
  let next: ModelTurnRequest = {
    model: overrides.model,
    profile: overrides.profile,
    route: overrides.route,
    prefix: overrides.prefix ?? {
      zone1: "Kernel rules stay pinned.",
      zone2: "MUST keep the write scope.",
    },
    messages: overrides.messages ?? [{ role: "user", text: "Reply with pong." }],
    tools: overrides.tools ?? [],
    replayItems: overrides.replayItems ?? [],
    reservedOutputTokens: overrides.reservedOutputTokens ?? 256,
    clientRequestId: overrides.clientRequestId ?? "client-req-1",
    idempotencyKey: overrides.idempotencyKey ?? "idem-1",
  };
  if (overrides.maxOutputTokens !== undefined)
    next = { ...next, maxOutputTokens: overrides.maxOutputTokens };
  if (overrides.temperature !== undefined) next = { ...next, temperature: overrides.temperature };
  if (overrides.previousResponseId !== undefined) {
    next = { ...next, previousResponseId: overrides.previousResponseId };
  }
  if (overrides.store !== undefined) next = { ...next, store: overrides.store };
  if (overrides.responseSchema !== undefined)
    next = { ...next, responseSchema: overrides.responseSchema };
  if (overrides.includeEncryptedReasoning !== undefined) {
    next = { ...next, includeEncryptedReasoning: overrides.includeEncryptedReasoning };
  }
  return next;
}

export interface CapturedRequest {
  readonly url: string;
  readonly headers: http.IncomingHttpHeaders;
  readonly body: string;
}

export async function withMock(
  respond: (res: http.ServerResponse, captured: CapturedRequest) => void | Promise<void>,
  run: (origin: string, captured: () => CapturedRequest) => Promise<void>,
): Promise<void> {
  let captured: CapturedRequest = { url: "", headers: {}, body: "" };
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      captured = {
        url: req.url ?? "",
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      };
      void Promise.resolve(respond(res, captured)).catch((error: unknown) => {
        if (!res.headersSent) res.writeHead(500);
        res.end(error instanceof Error ? error.message : "mock failed");
      });
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected a tcp port");
  try {
    await run(`http://127.0.0.1:${address.port}`, () => captured);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

export function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function sseData(data: unknown): string {
  return `data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`;
}

export function writeSse(res: http.ServerResponse, payload: string): void {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
  });
  res.write(payload);
  res.end();
}

export async function collect(source: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of source) events.push(event);
  return events;
}

export function fragmentingFetch(byteSize = 1): typeof fetch {
  return async (input, init) => {
    const response = await fetch(input, init);
    const body = response.body;
    if (!body) return response;
    const reader = body.getReader();
    let pending: Uint8Array | null = null;
    let offset = 0;
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        while (!pending || offset >= pending.length) {
          const next = await reader.read();
          if (next.done) {
            controller.close();
            return;
          }
          pending = next.value;
          offset = 0;
        }
        const slice = pending.subarray(offset, Math.min(offset + byteSize, pending.length));
        controller.enqueue(new Uint8Array(slice));
        offset += slice.length;
      },
    });
    return new Response(stream, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

export function callOptions(
  origin: string,
  extra: Partial<AdapterCallOptions> = {},
): AdapterCallOptions {
  return {
    baseUrl: origin,
    apiKey: extra.apiKey ?? "local-test-key-0123456789",
    ...extra,
  };
}
