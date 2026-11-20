import {
  NormalizedModelError,
  SiwcConstraintError,
  type NormalizedErrorKind,
} from "./model-error.js";
import type { TokenUsage } from "./usage.js";

const USAGE_LIMIT_CODE = "subscription_sharing_usage_limit_exceeded";

const CONTEXT_CODES = [
  "context_length_exceeded",
  "context_overflow",
  "prompt_too_long",
  "request_too_large",
] as const;

const BILLING_CODES = [
  "insufficient_quota",
  "billing_hard_limit_reached",
  "credit_balance_too_low",
  "payment_required",
] as const;

export interface RateLimitDelay {
  readonly retryAfterMs: number | null;
  readonly rateLimitResetMs: number | null;
}

export function parseDelayMs(raw: string, nowMs: number): number | null {
  const value = raw.trim();
  if (value.length === 0) return null;
  const milliseconds = /^(\d+)ms$/.exec(value);
  const millisecondDigits = milliseconds?.[1];
  if (millisecondDigits !== undefined) return Number(millisecondDigits);
  const duration = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)(?:\.(\d+))?s)?$/.exec(value);
  if (
    duration &&
    (duration[1] !== undefined || duration[2] !== undefined || duration[3] !== undefined)
  ) {
    const hours = Number(duration[1] ?? "0");
    const minutes = Number(duration[2] ?? "0");
    const seconds = Number(duration[3] ?? "0");
    const fraction = duration[4] ?? "";
    const fractionMs = fraction.length === 0 ? 0 : Number(fraction.padEnd(3, "0").slice(0, 3));
    return ((hours * 60 + minutes) * 60 + seconds) * 1000 + fractionMs;
  }
  if (/^\d+$/.test(value)) {
    const numeric = Number(value);
    if (value.length >= 13) return Math.max(0, numeric - nowMs);
    if (value.length >= 10) return Math.max(0, numeric * 1000 - nowMs);
    return numeric * 1000;
  }
  const parsedDate = Date.parse(value);
  if (!Number.isNaN(parsedDate)) return Math.max(0, parsedDate - nowMs);
  return null;
}

export function parseRateLimitHeaders(headers: Headers, nowMs: number): RateLimitDelay {
  const retryRaw = headers.get("retry-after");
  const retryAfterMs = retryRaw === null ? null : parseDelayMs(retryRaw, nowMs);
  let rateLimitResetMs: number | null = null;
  headers.forEach((headerValue, headerName) => {
    const name = headerName.toLowerCase();
    const isReset =
      name.startsWith("x-ratelimit-reset") ||
      (name.startsWith("anthropic-ratelimit-") && name.endsWith("-reset"));
    if (!isReset) return;
    const parsed = parseDelayMs(headerValue, nowMs);
    if (parsed === null) return;
    rateLimitResetMs = rateLimitResetMs === null ? parsed : Math.max(rateLimitResetMs, parsed);
  });
  return { retryAfterMs, rateLimitResetMs };
}

export function classifyProviderFailure(input: {
  readonly status: number;
  readonly headers: Headers;
  readonly bodyText: string;
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly nowMs?: number;
  readonly partialUsage?: TokenUsage | null;
}): NormalizedModelError {
  const nowMs = input.nowMs ?? Date.now();
  const providerCode = extractProviderCode(input.bodyText);
  const delays = parseRateLimitHeaders(input.headers, nowMs);
  const kind = classifyKind(input.status, providerCode, input.bodyText);
  const message = extractProviderMessage(input.bodyText) ?? `provider HTTP ${input.status}`;
  return new NormalizedModelError({
    kind,
    message,
    httpStatus: input.status,
    providerCode,
    retryAfterMs: delays.retryAfterMs,
    rateLimitResetMs: delays.rateLimitResetMs,
    isProviderSchedulingError: kind === "rate_limit" || kind === "usage_limit",
    clientRequestId: input.clientRequestId,
    idempotencyKey: input.idempotencyKey,
    partialUsage: input.partialUsage ?? null,
  });
}

function classifyKind(
  status: number,
  providerCode: string | null,
  bodyText: string,
): NormalizedErrorKind {
  if (providerCode === USAGE_LIMIT_CODE || bodyText.includes(USAGE_LIMIT_CODE))
    return "usage_limit";
  if (status === 401) return "auth";
  if (status === 429) return "rate_limit";
  if (status === 402 || hasCode(providerCode, bodyText, BILLING_CODES)) return "billing";
  if (status === 503 || status === 529) return "overloaded";
  if (hasCode(providerCode, bodyText, CONTEXT_CODES) || /prompt is too long/i.test(bodyText)) {
    return "context_overflow";
  }
  if (providerCode === "overloaded_error") return "overloaded";
  if (status === 400 || status === 422) return "malformed_request";
  if (status === 403) return "auth";
  return "unknown";
}

function hasCode(providerCode: string | null, bodyText: string, codes: readonly string[]): boolean {
  return codes.some((code) => providerCode === code || bodyText.includes(code));
}

function extractProviderCode(bodyText: string): string | null {
  const record = parseObject(bodyText);
  if (!record) return null;
  const direct = stringField(record, "code") ?? stringField(record, "type");
  if (direct) return direct;
  const nested = record.error;
  if (nested && typeof nested === "object") {
    const errorRecord = nested as Record<string, unknown>;
    return stringField(errorRecord, "code") ?? stringField(errorRecord, "type");
  }
  return null;
}

function extractProviderMessage(bodyText: string): string | null {
  const record = parseObject(bodyText);
  if (!record) return null;
  const direct = stringField(record, "message");
  if (direct) return direct;
  const nested = record.error;
  if (nested && typeof nested === "object") {
    return stringField(nested as Record<string, unknown>, "message");
  }
  return null;
}

function parseObject(bodyText: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(bodyText) as unknown;
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function assertSiwcCompliantBody(body: unknown): void {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("SIWC body must be a JSON object");
  }
  const record = body as Record<string, unknown>;
  const violations: string[] = [];
  if ("max_output_tokens" in record) violations.push("max_output_tokens");
  if ("temperature" in record) violations.push("temperature");
  if ("previous_response_id" in record) violations.push("previous_response_id");
  if (record.store !== false) violations.push("store");
  if (record.stream !== true) violations.push("stream");
  const tools = record.tools;
  if (Array.isArray(tools)) {
    for (const tool of tools) {
      if (tool === null || typeof tool !== "object") continue;
      const type = (tool as Record<string, unknown>).type;
      if (type !== "function" && type !== "custom") {
        violations.push(`hosted_tool:${String(type)}`);
      }
    }
  }
  if (violations.length > 0) throw new SiwcConstraintError(violations);
}
