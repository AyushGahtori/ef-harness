import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { UnrecordedHttpRequestError } from "./errors.js";
import { closeServer, listenLoopback, readLimitedBody } from "./net-util.js";
import { isEnoent } from "./paths.js";
import { DefaultSecretRedactor, type SecretRedactor } from "./secret-redactor.js";
import type { ServiceConnection, ServiceCreateRequest, ServiceProvider } from "./types.js";

const RECORDED_BODY_LIMIT = 1_000_000;
const HOP_BY_HOP = new Set(["host", "connection", "content-length", "transfer-encoding", "keep-alive"]);

export interface RecordedHttpExchange {
  readonly method: string;
  readonly url: string;
  readonly requestHeaders: Readonly<Record<string, string>>;
  readonly requestBody: string;
  readonly status: number;
  readonly responseHeaders: Readonly<Record<string, string>>;
  readonly responseBody: string;
}

export interface CassetteStore {
  put(bytes: Uint8Array): Promise<string>;
  get(casKey: string): Promise<Uint8Array | null>;
}

export class FilesystemCassetteStore implements CassetteStore {
  constructor(private readonly root: string) {}

  async put(bytes: Uint8Array): Promise<string> {
    const hash = createHash("sha256").update(bytes).digest("hex");
    await mkdir(this.root, { recursive: true });
    await writeFile(path.join(this.root, hash), bytes);
    return hash;
  }

  async get(casKey: string): Promise<Uint8Array | null> {
    if (!/^[0-9a-f]{64}$/.test(casKey)) return null;
    try {
      return await readFile(path.join(this.root, casKey));
    } catch (error) {
      if (isEnoent(error)) return null;
      throw error;
    }
  }
}

export function normalizedHttpUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl, "http://replay.local");
  const params = [...parsed.searchParams.entries()].sort((left, right) => {
    const byName = left[0].localeCompare(right[0]);
    return byName === 0 ? left[1].localeCompare(right[1]) : byName;
  });
  const search = new URLSearchParams(params).toString();
  return `${parsed.pathname}${search ? `?${search}` : ""}`;
}

interface ReplayState {
  envId: string;
  projectId: string;
  mode: "record" | "replay";
  approved: boolean;
  upstreamBaseUrl: string | null;
  exchanges: RecordedHttpExchange[];
  cassetteKey: string | null;
  server: http.Server | null;
  baseUrl: string;
}

export interface HttpReplayConnection extends ServiceConnection {
  readonly service: "http_replay";
  readonly baseUrl: string;
  readonly mode: "record" | "replay";
  latestCassetteKey(): string | null;
}

export interface HttpRecordReplayOptions {
  readonly redactor?: SecretRedactor;
  readonly store?: CassetteStore;
  readonly fetchImpl?: typeof fetch;
  readonly cassetteRoot?: string;
}

export class HttpRecordReplayProvider implements ServiceProvider {
  readonly service = "http_replay" as const;
  readonly misses: UnrecordedHttpRequestError[] = [];
  private readonly redactor: SecretRedactor;
  private readonly fetchImpl: typeof fetch;
  private readonly store: CassetteStore | null;
  private readonly cassetteRoot: string | null;
  private activeStore: CassetteStore | null = null;
  private readonly envs = new Map<string, ReplayState>();

  constructor(options: HttpRecordReplayOptions = {}) {
    this.redactor = options.redactor ?? new DefaultSecretRedactor();
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.store = options.store ?? null;
    this.cassetteRoot = options.cassetteRoot ?? null;
  }

  async create(request: ServiceCreateRequest): Promise<HttpReplayConnection> {
    if (this.envs.has(request.envId)) {
      throw new Error(`http replay environment ${request.envId} already exists`);
    }
    const mode = request.httpMode;
    if (mode !== "record" && mode !== "replay") {
      throw new Error("httpMode must be record or replay");
    }
    if (mode === "record" && request.httpApproved !== true) {
      throw new Error("HTTP recording requires explicit approval");
    }
    if (mode === "record" && !request.upstreamBaseUrl) {
      throw new Error("HTTP recording requires an upstream base URL");
    }
    if (mode === "replay" && !request.cassetteKey) {
      throw new Error("HTTP replay requires a cassette key");
    }
    const store = this.storeFor(request.tempDir);
    this.activeStore = store;
    const exchanges =
      mode === "replay" && request.cassetteKey
        ? await loadCassette(store, request.cassetteKey)
        : [];
    const state: ReplayState = {
      envId: request.envId,
      projectId: request.projectId,
      mode,
      approved: request.httpApproved === true,
      upstreamBaseUrl: request.upstreamBaseUrl ?? null,
      exchanges,
      cassetteKey: request.cassetteKey ?? null,
      server: null,
      baseUrl: "",
    };
    const server = http.createServer((req, res) => {
      void this.handle(state, req, res);
    });
    const port = await listenLoopback(server);
    state.server = server;
    state.baseUrl = `http://127.0.0.1:${port}`;
    this.envs.set(request.envId, state);
    return this.connection(state);
  }

  replayLookup(envId: string, method: string, url: string): RecordedHttpExchange {
    const state = this.require(envId);
    return this.matchOrThrow(state, method, url);
  }

  async resetData(envId: string): Promise<void> {
    const state = this.require(envId);
    if (state.mode === "record") {
      state.exchanges = [];
      state.cassetteKey = null;
      return;
    }
    if (state.cassetteKey && this.activeStore) {
      state.exchanges = await loadCassette(this.activeStore, state.cassetteKey);
    }
  }

  async destroy(envId: string): Promise<void> {
    const state = this.envs.get(envId);
    if (!state) return;
    this.envs.delete(envId);
    if (state.server) await closeServer(state.server);
  }

  async closeProject(projectId: string): Promise<void> {
    const ids = [...this.envs.values()]
      .filter((state) => state.projectId === projectId)
      .map((state) => state.envId);
    for (const envId of ids) await this.destroy(envId);
  }

  private async handle(state: ReplayState, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = (req.method ?? "GET").toUpperCase();
    const rawUrl = req.url ?? "/";
    if (state.mode === "replay") {
      try {
        const match = this.matchOrThrow(state, method, rawUrl);
        res.writeHead(match.status, { ...match.responseHeaders, "x-ef-replay": "hit" });
        res.end(match.responseBody);
      } catch (error) {
        if (error instanceof UnrecordedHttpRequestError) {
          res.writeHead(502, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: error.name, method: error.method, url: error.url }));
          return;
        }
        res.writeHead(500, { "content-type": "text/plain" });
        res.end(error instanceof Error ? error.message : "replay error");
      }
      return;
    }
    if (!state.approved || !state.upstreamBaseUrl) {
      res.writeHead(403, { "content-type": "text/plain" });
      res.end("HTTP recording is not approved");
      return;
    }
    const read = await readLimitedBody(req, RECORDED_BODY_LIMIT);
    if (read.tooLarge) {
      res.writeHead(413, { "content-type": "text/plain" });
      res.end("recorded body exceeds the cassette limit");
      return;
    }
    const requestHeaders = headersFrom(req);
    const upstream = await this.fetchImpl(joinUpstream(state.upstreamBaseUrl, rawUrl), {
      method,
      headers: forwardHeaders(requestHeaders),
      ...(read.body.length > 0 ? { body: read.body } : {}),
    });
    const responseBuffer = Buffer.from(await upstream.arrayBuffer());
    const responseHeaders = headersFromResponse(upstream.headers);
    const exchange: RecordedHttpExchange = {
      method,
      url: normalizedHttpUrl(rawUrl),
      requestHeaders: this.redactor.redactHeaders(requestHeaders),
      requestBody: this.redactor.redactBody(read.body.toString("utf8"), requestHeaders["content-type"]),
      status: upstream.status,
      responseHeaders: this.redactor.redactHeaders(responseHeaders),
      responseBody: this.redactor.redactBody(
        responseBuffer.toString("utf8"),
        responseHeaders["content-type"],
      ),
    };
    state.exchanges.push(exchange);
    const store = this.activeStore ?? this.storeFor(process.cwd());
    state.cassetteKey = await store.put(Buffer.from(JSON.stringify(state.exchanges)));
    res.writeHead(upstream.status, {
      "content-type": responseHeaders["content-type"] ?? "application/octet-stream",
      "x-ef-replay": "recorded",
    });
    res.end(responseBuffer);
  }

  private matchOrThrow(state: ReplayState, method: string, rawUrl: string): RecordedHttpExchange {
    const key = `${method.toUpperCase()} ${normalizedHttpUrl(rawUrl)}`;
    const found = state.exchanges.find(
      (exchange) => `${exchange.method.toUpperCase()} ${exchange.url}` === key,
    );
    if (!found) {
      const error = new UnrecordedHttpRequestError(method.toUpperCase(), normalizedHttpUrl(rawUrl));
      this.misses.push(error);
      throw error;
    }
    return found;
  }

  private connection(state: ReplayState): HttpReplayConnection {
    return {
      service: "http_replay",
      envId: state.envId,
      projectId: state.projectId,
      baseUrl: state.baseUrl,
      mode: state.mode,
      latestCassetteKey: () => state.cassetteKey,
      variables: {
        HTTP_REPLAY_BASE_URL: state.baseUrl,
        HTTP_REPLAY_MODE: state.mode,
      },
    };
  }

  private require(envId: string): ReplayState {
    const state = this.envs.get(envId);
    if (!state) throw new Error(`unknown http replay environment ${envId}`);
    return state;
  }

  private storeFor(tempDir: string): CassetteStore {
    if (this.store) return this.store;
    const root = this.cassetteRoot ?? path.join(tempDir || process.cwd(), "cassettes");
    return new FilesystemCassetteStore(root);
  }
}

function joinUpstream(base: string, rawUrl: string): string {
  const target = new URL(rawUrl, "http://replay.local");
  const upstream = new URL(base);
  const prefix = upstream.pathname.replace(/\/$/, "");
  upstream.pathname = `${prefix}${target.pathname}`;
  upstream.search = target.search;
  return upstream.toString();
}

async function loadCassette(store: CassetteStore, casKey: string): Promise<RecordedHttpExchange[]> {
  const bytes = await store.get(casKey);
  if (!bytes) throw new Error(`cassette ${casKey} was not found in CAS`);
  const parsed: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
  if (!Array.isArray(parsed)) throw new Error("cassette is not a list of exchanges");
  return parsed.map((item) => {
    if (!item || typeof item !== "object") throw new Error("cassette exchange is malformed");
    const exchange = item as Record<string, unknown>;
    if (typeof exchange.method !== "string" || typeof exchange.url !== "string") {
      throw new Error("cassette exchange is missing a method or url");
    }
    return {
      method: exchange.method,
      url: exchange.url,
      requestHeaders: stringRecord(exchange.requestHeaders),
      requestBody: typeof exchange.requestBody === "string" ? exchange.requestBody : "",
      status: typeof exchange.status === "number" ? exchange.status : 0,
      responseHeaders: stringRecord(exchange.responseHeaders),
      responseBody: typeof exchange.responseBody === "string" ? exchange.responseBody : "",
    };
  });
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const output: Record<string, string> = {};
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === "string") output[key] = child;
  }
  return output;
}

function headersFrom(req: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  }
  return headers;
}

function headersFromResponse(headers: Headers): Record<string, string> {
  const output: Record<string, string> = {};
  headers.forEach((value, key) => {
    output[key.toLowerCase()] = value;
  });
  return output;
}

function forwardHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  const forwarded: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (HOP_BY_HOP.has(name.toLowerCase())) continue;
    forwarded[name] = value;
  }
  return forwarded;
}
