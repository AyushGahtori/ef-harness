import tls from "node:tls";
import type { Clock, TlsProbe, TlsReport } from "./types.js";
import { MutatingSmokeForbiddenError } from "./errors.js";

export const HEALTH_WARMUP_MAX_MS = 60_000;
export const HEALTH_WARMUP_INTERVAL_MS = 2_000;
export const ERROR_WATCH_WINDOW_MS = 10 * 60 * 1000;
export const ERROR_WATCH_POLL_MS = 30_000;
export const CONSECUTIVE_HEALTH_FAILS = 3;
export const DEFAULT_FIVE_XX_RATE_THRESHOLD = 0.05;
export const CRASH_LOOP_RESTART_THRESHOLD = 3;
export const UNHANDLED_EXCEPTION_THRESHOLD = 5;
export const PROBE_TIMEOUT_MS = 10_000;
export const LOCAL_OFFLINE_WATCH_MESSAGE =
  "Local internet offline — watch paused, live app unaffected";

export const SMOKE_VIEWPORTS = [
  { width: 375, height: 812 },
  { width: 1440, height: 900 },
] as const;

export const systemClock: Clock = {
  now: () => Date.now(),
  wait(ms: number, signal?: AbortSignal): Promise<void> {
    if (ms <= 0 || signal?.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(finish, ms);
      function finish(): void {
        clearTimeout(timer);
        signal?.removeEventListener("abort", finish);
        resolve();
      }
      signal?.addEventListener("abort", finish, { once: true });
    });
  },
};

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export function isLiveSideEffectHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "stripe.com" || host.endsWith(".stripe.com")) return true;
  if (host === "resend.com" || host.endsWith(".resend.com")) return true;
  if (host === "api.smtp.com") return true;
  return false;
}

export function assertSmokeRequestAllowed(method: string, rawUrl: string): void {
  const normalized = method.toUpperCase();
  if (normalized !== "GET" && normalized !== "HEAD") {
    throw new MutatingSmokeForbiddenError(
      `Post-deploy smoke forbids ${normalized} (read-only GET/HEAD only)`,
    );
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new MutatingSmokeForbiddenError(`Post-deploy smoke refused invalid URL (${reason})`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new MutatingSmokeForbiddenError(`Post-deploy smoke forbids ${url.protocol} URLs`);
  }
  if (isLiveSideEffectHost(url.hostname)) {
    throw new MutatingSmokeForbiddenError(
      `Post-deploy smoke forbids live side-effect host ${url.hostname}`,
    );
  }
  if (/\/api\/(email|emails|mail|messages)(\/|$)/i.test(url.pathname)) {
    throw new MutatingSmokeForbiddenError("Post-deploy smoke forbids email endpoints");
  }
}

export function joinUrl(origin: string, route: string): string {
  if (route.startsWith("http://") || route.startsWith("https://")) return route;
  const base = origin.endsWith("/") ? origin : `${origin}/`;
  return new URL(route.replace(/^\//, ""), base).href;
}

export function defaultTlsProbe(target: URL): Promise<TlsReport> {
  if (target.protocol === "http:") {
    if (isLoopbackHost(target.hostname)) {
      return Promise.resolve({ valid: true, mode: "loopback-plaintext" });
    }
    return Promise.resolve({
      valid: false,
      mode: "plaintext-remote",
      reason: "Remote deploy URLs require a valid TLS certificate",
    });
  }
  if (target.protocol !== "https:") {
    return Promise.resolve({
      valid: false,
      mode: "unsupported",
      reason: `Unsupported protocol ${target.protocol}`,
    });
  }
  const port = Number(target.port || 443);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (report: TlsReport): void => {
      if (settled) return;
      settled = true;
      resolve(report);
    };
    const socket = tls.connect(
      {
        host: target.hostname,
        port,
        servername: target.hostname,
        timeout: PROBE_TIMEOUT_MS,
      },
      () => {
        const certificate = socket.getPeerCertificate();
        const authorized = socket.authorized;
        const expiresAt = certificate.valid_to
          ? new Date(certificate.valid_to).toISOString()
          : undefined;
        const authorizationError = socket.authorizationError;
        socket.end();
        if (!authorized) {
          finish({
            valid: false,
            mode: "https",
            reason:
              typeof authorizationError === "string"
                ? authorizationError
                : "TLS certificate is not trusted",
          });
          return;
        }
        if (expiresAt && Number.isFinite(Date.parse(expiresAt)) && Date.parse(expiresAt) <= Date.now()) {
          finish({
            valid: false,
            mode: "https",
            expiresAt,
            reason: "TLS certificate is expired",
          });
          return;
        }
        finish(expiresAt ? { valid: true, mode: "https", expiresAt } : { valid: true, mode: "https" });
      },
    );
    socket.on("timeout", () => {
      socket.destroy();
      finish({ valid: false, mode: "https", reason: "TLS handshake timed out" });
    });
    socket.on("error", (error) => {
      finish({ valid: false, mode: "https", reason: error.message });
    });
  });
}

export const defaultTls: TlsProbe = defaultTlsProbe;

export interface BufferedResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly body: string;
  readonly contentType: string;
}

export async function fetchBuffered(
  url: string,
  init: {
    readonly method?: "GET" | "HEAD";
    readonly fetchImpl?: typeof fetch;
  },
): Promise<BufferedResponse> {
  const method = init.method ?? "GET";
  assertSmokeRequestAllowed(method, url);
  const fetchImpl = init.fetchImpl ?? fetch;
  const response = await fetchImpl(url, {
    method,
    redirect: "manual",
    cache: "no-store",
    headers: {
      accept: "*/*",
      "cache-control": "no-cache",
      pragma: "no-cache",
    },
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  const body = method === "HEAD" ? "" : await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body,
    contentType: response.headers.get("content-type") ?? "",
  };
}

export function readOnlyRequest(
  redirect: "follow" | "manual",
  fetchImpl: typeof fetch | undefined,
  method: "GET" | "HEAD" = "GET",
): {
  readonly method: "GET" | "HEAD";
  readonly redirect: "follow" | "manual";
  readonly fetchImpl?: typeof fetch;
} {
  return fetchImpl ? { method, redirect, fetchImpl } : { method, redirect };
}

export async function fetchReadOnly(
  url: string,
  init: {
    readonly method?: "GET" | "HEAD";
    readonly redirect?: "follow" | "manual";
    readonly fetchImpl?: typeof fetch;
  },
): Promise<BufferedResponse> {
  const method = init.method ?? "GET";
  const buffered = init.fetchImpl ? { method, fetchImpl: init.fetchImpl } : { method };
  if ((init.redirect ?? "manual") === "manual") {
    return fetchBuffered(url, buffered);
  }
  let current = url;
  let last: BufferedResponse | null = null;
  for (let hop = 0; hop < 3; hop += 1) {
    last = await fetchBuffered(current, buffered);
    if (last.status < 300 || last.status >= 400) return last;
    const location = last.headers.get("location");
    if (!location) return last;
    current = new URL(location, current).href;
  }
  if (!last) {
    throw new MutatingSmokeForbiddenError("Post-deploy read-only fetch produced no response");
  }
  return last;
}

const STACK_FRAME = /\bat\s+\S+\s+\([^)\n]*:\d+:\d+\)/;

export function containsStackTrace(headers: Headers, body: string): boolean {
  for (const [name, value] of headers.entries()) {
    if (/^(x-)?(error-)?stack(-trace)?$/i.test(name) && value.trim().length > 0) return true;
    if (STACK_FRAME.test(value)) return true;
  }
  if (STACK_FRAME.test(body)) return true;
  const parsed = parseJsonObject(body);
  return typeof parsed?.stack === "string" && parsed.stack.includes("\n");
}

export function parseJsonObject(body: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(body);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return null;
  } catch (error) {
    return error instanceof SyntaxError ? null : null;
  }
}

export function extractBuildId(headers: Headers, body: string): string | null {
  const parsed = parseJsonObject(body);
  if (parsed) {
    if (typeof parsed.buildId === "string" && parsed.buildId.trim()) return parsed.buildId.trim();
    if (typeof parsed.commitSha === "string" && parsed.commitSha.trim()) return parsed.commitSha.trim();
  }
  for (const name of ["x-ef-build-id", "x-build-id", "x-commit-sha"]) {
    const value = headers.get(name)?.trim();
    if (value) return value;
  }
  const named = body.match(
    /<meta[^>]*name=["'](?:ef-build-id|build-id)["'][^>]*content=["']([^"']+)["'][^>]*>/i,
  );
  if (named?.[1]) return named[1].trim();
  const reversed = body.match(
    /<meta[^>]*content=["']([^"']+)["'][^>]*name=["'](?:ef-build-id|build-id)["'][^>]*>/i,
  );
  return reversed?.[1]?.trim() ?? null;
}

export function hasDataEfSource(html: string): boolean {
  return /data-ef-source\s*=/i.test(html);
}

export function isHtml(contentType: string, body: string): boolean {
  return contentType.toLowerCase().includes("html") || /^\s*</.test(body);
}

export function pageTitle(html: string): string {
  const match = html.match(/<title>([^<]*)<\/title>/i);
  return (match?.[1] ?? "").trim();
}

export function shellMounted(html: string): boolean {
  return (
    /<main\b/i.test(html) ||
    /data-app-shell\b/i.test(html) ||
    /id=["'](?:app|root)["']/i.test(html)
  );
}

export function dnsName(value: string): string {
  return value.trim().replace(/\.$/, "").toLowerCase();
}

export async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("PROBE_TIMEOUT")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function describeDockerLogsPoll(container: string, sinceIso: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(container)) {
    throw new Error(`Refusing unsafe container name: ${container}`);
  }
  if (!/^[0-9T:Z.+-]+$/.test(sinceIso)) {
    throw new Error(`Refusing unsafe docker --since value: ${sinceIso}`);
  }
  return `docker logs --since ${sinceIso} ${container}`;
}

export function describeVercelMetricsPoll(deploymentId: string): string {
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(deploymentId)) {
    throw new Error(`Refusing unsafe deployment id: ${deploymentId}`);
  }
  return `GET /v2/deployments/${deploymentId}/events`;
}
