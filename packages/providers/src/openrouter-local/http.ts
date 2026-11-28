import { DISCOVERY_TIMEOUT_MS } from "./constants.js";
import { OpenRouterLocalError } from "./errors.js";
import { readJsonResponse } from "./json.js";
import type { FetchPort } from "./ports.js";

export function isConnectionRefused(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && !seen.has(current)) {
    seen.add(current);
    if (typeof current === "object") {
      const record = current as { code?: unknown; cause?: unknown; message?: unknown };
      if (record.code === "ECONNREFUSED" || record.code === "ECONNRESET") return true;
      if (typeof record.message === "string" && record.message.includes("ECONNREFUSED")) return true;
      current = record.cause;
      continue;
    }
    break;
  }
  return false;
}

export async function fetchWithTimeout(
  fetchImpl: FetchPort,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      ...init,
      redirect: "manual",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson(
  fetchImpl: FetchPort,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ readonly status: number; readonly body: unknown }> {
  let response: Response;
  try {
    response = await fetchWithTimeout(fetchImpl, url, init, timeoutMs);
  } catch (error) {
    if (isConnectionRefused(error)) {
      throw new OpenRouterLocalError("connection-refused", "connection refused");
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new OpenRouterLocalError("timeout", `request exceeded ${timeoutMs} ms`);
    }
    throw error;
  }
  if (response.status >= 300 && response.status < 400) {
    throw new OpenRouterLocalError("redirect-blocked", "local discovery does not follow redirects");
  }
  const body = response.status === 204 ? null : await readJsonResponse(response);
  return { status: response.status, body };
}

export function clampDiscoveryTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) return DISCOVERY_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return DISCOVERY_TIMEOUT_MS;
  return Math.min(timeoutMs, DISCOVERY_TIMEOUT_MS);
}
