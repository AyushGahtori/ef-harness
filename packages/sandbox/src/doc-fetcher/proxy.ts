import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import { createBrotliDecompress, createGunzip, createInflate, type BrotliDecompress, type Gunzip, type Inflate } from "node:zlib";
import { AllowlistProxyServer as LoopbackAllowlistProxy } from "../proxy/allowlist-proxy-server.js";
import { ProxyFetchError } from "../proxy/pinned-fetch.js";
import { PORT_LEASE_MAX, PORT_LEASE_MIN, type PortLease } from "../proxy/types.js";
import { DocFetchError, DownloadTooLargeError, SsrfBlockedError } from "./errors.js";
import { DOC_FETCH_USER_AGENT, assertReadOnlyMethod, isBlockedAddress, isIpLiteral } from "./policy.js";

export interface AllowlistProxyRequest {
  readonly method: "GET" | "HEAD";
  readonly profile: "researcher";
  readonly url: string;
  readonly pinnedAddress: string;
  readonly servername: string;
  readonly timeoutMs: number;
  readonly maxBytes: number;
}

export interface AllowlistProxyResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

export interface AllowlistProxyServer {
  fetch(request: AllowlistProxyRequest): Promise<AllowlistProxyResponse>;
}

export interface ProxyConnectInfo {
  readonly address: string;
  readonly host: string;
  readonly port: number;
}

export interface DirectProxyOptions {
  readonly testOnlyLoopbackOverride?: boolean;
  readonly onConnect?: (info: ProxyConnectInfo) => void;
}

let nextResearcherPort = PORT_LEASE_MIN;

function researcherLease(now: number): PortLease {
  const port = nextResearcherPort;
  nextResearcherPort = nextResearcherPort >= PORT_LEASE_MAX ? PORT_LEASE_MIN : nextResearcherPort + 1;
  return {
    port,
    projectId: "researcher-doc",
    environment: "doc-fetcher",
    leasedAt: now,
    expiresAt: null,
  };
}

export class BoundResearcherAllowlistProxy implements AllowlistProxyServer {
  readonly server: LoopbackAllowlistProxy;
  private readonly testOnlyLoopbackOverride: boolean;
  private readonly onConnect: ((info: ProxyConnectInfo) => void) | null;

  constructor(options: DirectProxyOptions = {}) {
    this.testOnlyLoopbackOverride = options.testOnlyLoopbackOverride === true;
    this.onConnect = options.onConnect ?? null;
    this.server = new LoopbackAllowlistProxy({
      portLease: researcherLease(Date.now()),
      ...(this.testOnlyLoopbackOverride ? { testOnlyPrivateIpAllowlist: ["127.0.0.1", "::1"] } : {}),
    });
  }

  get proxyUrl(): string {
    return this.server.proxyUrl;
  }

  async fetch(request: AllowlistProxyRequest): Promise<AllowlistProxyResponse> {
    assertReadOnlyMethod(request.method);
    if (request.profile !== "researcher") {
      throw new DocFetchError("PROFILE", "documentation fetches use the researcher profile");
    }
    const url = new URL(request.url);
    const port = url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new DocFetchError("BAD_PORT", "invalid port");
    }
    const allowLoopback = this.testOnlyLoopbackOverride && !isIpLiteral(request.servername);
    if (isBlockedAddress(request.pinnedAddress, { allowLoopbackFixture: allowLoopback })) {
      throw new SsrfBlockedError(request.pinnedAddress);
    }
    this.onConnect?.({ address: request.pinnedAddress, host: request.servername, port });
    try {
      const response = await this.server.fetch(request.url, {
        method: request.method,
        profile: "researcher",
        attemptId: "researcher-doc",
        pinnedAddress: request.pinnedAddress,
        servername: request.servername,
        timeoutMs: request.timeoutMs,
        maxBytes: request.maxBytes,
      });
      return { status: response.status, headers: response.headers, body: response.body };
    } catch (error) {
      if (error instanceof ProxyFetchError && error.code === "private_ip") {
        throw new SsrfBlockedError(request.pinnedAddress);
      }
      if (error instanceof ProxyFetchError && error.code === "response_too_large") {
        throw new DownloadTooLargeError(request.maxBytes);
      }
      if (error instanceof ProxyFetchError && error.code === "timeout") {
        throw new DocFetchError("TIMEOUT", "doc fetch timed out", { cause: error });
      }
      if (error instanceof ProxyFetchError) {
        throw new DocFetchError("NETWORK", error.message, { cause: error });
      }
      throw error;
    }
  }
}

export class DirectResearcherAllowlistProxy implements AllowlistProxyServer {
  private readonly testOnlyLoopbackOverride: boolean;
  private readonly onConnect: ((info: ProxyConnectInfo) => void) | null;

  constructor(options: DirectProxyOptions = {}) {
    this.testOnlyLoopbackOverride = options.testOnlyLoopbackOverride === true;
    this.onConnect = options.onConnect ?? null;
  }

  async fetch(request: AllowlistProxyRequest): Promise<AllowlistProxyResponse> {
    assertReadOnlyMethod(request.method);
    if (request.profile !== "researcher") {
      throw new DocFetchError("PROFILE", "documentation fetches use the researcher profile");
    }
    const url = new URL(request.url);
    const port = url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new DocFetchError("BAD_PORT", "invalid port");
    }
    const allowLoopback = this.testOnlyLoopbackOverride && !isIpLiteral(request.servername);
    if (isBlockedAddress(request.pinnedAddress, { allowLoopbackFixture: allowLoopback })) {
      throw new SsrfBlockedError(request.pinnedAddress);
    }
    this.onConnect?.({ address: request.pinnedAddress, host: request.servername, port });
    return transfer(request, url, port);
  }
}

function transfer(request: AllowlistProxyRequest, url: URL, port: number): Promise<AllowlistProxyResponse> {
  const isTls = url.protocol === "https:";
  const headers: Record<string, string> = {
    Host: url.host,
    Accept: "text/html,application/xhtml+xml,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.1",
    "Accept-Encoding": "gzip, deflate, br",
    "User-Agent": DOC_FETCH_USER_AGENT,
    Connection: "close",
  };
  const options: https.RequestOptions = {
    protocol: url.protocol,
    hostname: request.pinnedAddress,
    port,
    method: request.method,
    path: `${url.pathname}${url.search}`,
    headers,
    timeout: request.timeoutMs,
    setHost: false,
  };
  if (isTls) {
    options.servername = url.hostname;
    options.checkServerIdentity = (_host, cert) => tls.checkServerIdentity(url.hostname, cert);
  }
  const lib = isTls ? https : http;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      callback();
    };
    const req = lib.request(options, (res) => {
      const status = res.statusCode ?? 0;
      const responseHeaders = headerMap(res.headers);
      if (status >= 300 && status < 400) {
        res.destroy();
        finish(() => resolve({ status, headers: responseHeaders, body: new Uint8Array() }));
        return;
      }
      const encoding = responseHeaders["content-encoding"] ?? "";
      if (!hasBodyEncoding(encoding)) {
        const advertised = Number(responseHeaders["content-length"]);
        if (Number.isFinite(advertised) && advertised > request.maxBytes) {
          res.destroy();
          req.destroy();
          finish(() => reject(new DownloadTooLargeError(request.maxBytes)));
          return;
        }
      }
      let stream: http.IncomingMessage | Gunzip | Inflate | BrotliDecompress = res;
      try {
        const decoder = decoderFor(encoding);
        if (decoder) stream = res.pipe(decoder);
      } catch (error) {
        res.destroy();
        finish(() => reject(error));
        return;
      }
      const chunks: Buffer[] = [];
      let received = 0;
      stream.on("data", (chunk: Buffer | string) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        received += buf.length;
        if (received > request.maxBytes) {
          stream.destroy();
          res.destroy();
          req.destroy();
          finish(() => reject(new DownloadTooLargeError(request.maxBytes)));
          return;
        }
        chunks.push(buf);
      });
      stream.on("end", () => {
        finish(() => resolve({ status, headers: responseHeaders, body: Buffer.concat(chunks) }));
      });
      stream.on("error", (error: Error) => {
        finish(() => reject(new DocFetchError("NETWORK", error.message, { cause: error })));
      });
    });
    req.on("timeout", () => {
      req.destroy();
      finish(() => reject(new DocFetchError("TIMEOUT", "doc fetch timed out")));
    });
    req.on("error", (error: Error) => {
      finish(() => reject(new DocFetchError("NETWORK", error.message, { cause: error })));
    });
    req.end();
  });
}

function hasBodyEncoding(encoding: string): boolean {
  const value = encoding.toLowerCase().split(",")[0]?.trim() ?? "";
  return value !== "" && value !== "identity";
}

function decoderFor(encoding: string): Gunzip | Inflate | BrotliDecompress | null {
  const value = encoding.toLowerCase().split(",")[0]?.trim() ?? "";
  if (value === "" || value === "identity") return null;
  if (value === "gzip" || value === "x-gzip") return createGunzip();
  if (value === "deflate") return createInflate();
  if (value === "br") return createBrotliDecompress();
  throw new DocFetchError("UNSUPPORTED_ENCODING", `unsupported content-encoding: ${value}`);
}

function headerMap(headers: http.IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    out[key.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}
