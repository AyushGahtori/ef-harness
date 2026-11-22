import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import type { FetchLike, SiwcTokenBundle } from "./ports.js";
import { SiwcError } from "./errors.js";

export async function postForm(
  fetchImpl: FetchLike,
  url: string,
  fields: Readonly<Record<string, string>>,
): Promise<{ status: number; text: string }> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
  return { status: response.status, text: await response.text() };
}

export function parseTokenBundle(raw: string): SiwcTokenBundle | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const access = record["access_token"];
  const refresh = record["refresh_token"];
  const idToken = record["id_token"];
  if (typeof access !== "string" || typeof refresh !== "string" || typeof idToken !== "string") return null;
  if (!access || !refresh || !idToken) return null;
  return { access_token: access, refresh_token: refresh, id_token: idToken };
}

export function serializeTokenBundle(bundle: SiwcTokenBundle): string {
  return JSON.stringify({
    access_token: bundle.access_token,
    refresh_token: bundle.refresh_token,
    id_token: bundle.id_token,
  });
}

export interface OAuthTokenResult {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly idToken: string | null;
  readonly expiresIn: number;
  readonly scope: string | null;
  readonly earliestRefreshAtMs: number | null;
  readonly error: string | null;
  readonly status: number;
}

export function parseOAuthTokenResult(status: number, text: string): OAuthTokenResult {
  let parsed: unknown = null;
  if (text.trim()) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      throw new SiwcError("token_response", "The ChatGPT token endpoint returned an unreadable response.");
    }
  }
  const record = typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : {};
  const error = typeof record["error"] === "string" ? record["error"] : null;
  const accessToken = typeof record["access_token"] === "string" ? record["access_token"] : "";
  const refreshToken = typeof record["refresh_token"] === "string" ? record["refresh_token"] : "";
  const idToken = typeof record["id_token"] === "string" ? record["id_token"] : null;
  const expiresIn = typeof record["expires_in"] === "number" ? record["expires_in"] : 3_600;
  const scope = typeof record["scope"] === "string" ? record["scope"] : null;
  const earliest = record["earliest_refresh_at"];
  const earliestRefreshAtMs = typeof earliest === "number" ? earliest * 1000 : null;
  return { accessToken, refreshToken, idToken, expiresIn, scope, earliestRefreshAtMs, error, status };
}

export interface DirectHttpResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: IncomingMessage;
  destroy(): void;
}

export function postJsonStream(
  url: string,
  headers: Readonly<Record<string, string>>,
  body: string,
  signal: AbortSignal,
): Promise<DirectHttpResponse> {
  const target = new URL(url);
  const transport = target.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = transport({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: "POST",
      headers: {
        ...headers,
        "content-length": String(Buffer.byteLength(body)),
      },
    }, (incoming) => {
      const mapped: Record<string, string> = {};
      for (const [key, value] of Object.entries(incoming.headers)) {
        if (typeof value === "string") mapped[key] = value;
        else if (Array.isArray(value)) mapped[key] = value.join(", ");
      }
      resolve({
        status: incoming.statusCode ?? 0,
        headers: mapped,
        body: incoming,
        destroy() {
          req.destroy();
        },
      });
    });
    const fail = (error: unknown) => {
      if (signal.aborted) {
        reject(new SiwcError("aborted", "The ChatGPT direct request was aborted."));
        return;
      }
      reject(error instanceof Error ? error : new SiwcError("direct_request", "The ChatGPT direct request failed."));
    };
    if (signal.aborted) {
      req.destroy();
      fail(new SiwcError("aborted", "The ChatGPT direct request was aborted."));
      return;
    }
    signal.addEventListener("abort", () => req.destroy(), { once: true });
    req.on("error", fail);
    req.write(body);
    req.end();
  });
}
