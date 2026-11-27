import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import {
  createBrotliDecompress,
  createGunzip,
  createInflate,
  type BrotliDecompress,
  type Gunzip,
  type Inflate,
} from "node:zlib";

export class ProxyFetchError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ProxyFetchError";
    this.code = code;
  }
}

export interface PinnedFetchRequest {
  readonly method: "GET" | "HEAD";
  readonly url: URL;
  readonly pinnedAddress: string;
  readonly family: 4 | 6;
  readonly servername: string;
  readonly timeoutMs: number;
  readonly maxBytes: number;
  readonly rejectUnauthorized: boolean;
}

export interface PinnedFetchResult {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
  readonly bytesOut: number;
}

const DOC_USER_AGENT = "ef-harness-doc-fetcher/1";

export function fetchPinned(request: PinnedFetchRequest): Promise<PinnedFetchResult> {
  const url = request.url;
  const headers: Record<string, string> = {
    Host: url.host,
    Accept: "text/html,application/xhtml+xml,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.1",
    "Accept-Encoding": "gzip, deflate, br",
    "User-Agent": DOC_USER_AGENT,
    Connection: "close",
  };
  const isTls = url.protocol === "https:";
  const options: https.RequestOptions = {
    protocol: url.protocol,
    hostname: request.pinnedAddress,
    port: url.port === "" ? (isTls ? 443 : 80) : Number(url.port),
    method: request.method,
    path: `${url.pathname}${url.search}`,
    headers,
    timeout: request.timeoutMs,
    setHost: false,
    family: request.family,
  };
  if (isTls) {
    options.servername = request.servername;
    options.rejectUnauthorized = request.rejectUnauthorized;
    options.checkServerIdentity = (_host, cert) => tls.checkServerIdentity(request.servername, cert);
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
        finish(() => resolve({ status, headers: responseHeaders, body: new Uint8Array(), bytesOut: 0 }));
        return;
      }
      const encoding = responseHeaders["content-encoding"] ?? "";
      if (!hasBodyEncoding(encoding)) {
        const advertised = Number(responseHeaders["content-length"]);
        if (Number.isFinite(advertised) && advertised > request.maxBytes) {
          res.destroy();
          req.destroy();
          finish(() => reject(new ProxyFetchError("response_too_large", "response exceeded the byte cap")));
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
          finish(() => reject(new ProxyFetchError("response_too_large", "response exceeded the byte cap")));
          return;
        }
        chunks.push(buf);
      });
      stream.on("end", () => {
        const body = Buffer.concat(chunks);
        finish(() => resolve({ status, headers: responseHeaders, body, bytesOut: body.byteLength }));
      });
      stream.on("error", (error: Error) => {
        finish(() => reject(new ProxyFetchError("network", error.message)));
      });
    });
    req.on("timeout", () => {
      req.destroy();
      finish(() => reject(new ProxyFetchError("timeout", "doc fetch timed out")));
    });
    req.on("error", (error: Error) => {
      finish(() => reject(new ProxyFetchError("network", error.message)));
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
  throw new ProxyFetchError("unsupported_encoding", `unsupported content-encoding: ${value}`);
}

function headerMap(headers: http.IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    out[key.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}
