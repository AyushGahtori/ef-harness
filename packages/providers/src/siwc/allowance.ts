export type AllowanceKind = "ok" | "rate_limit" | "usage_limit" | "other";

export interface SiwcAllowanceObservation {
  readonly rateLimits: Readonly<Record<string, string>>;
  readonly retryAfterSeconds: number | null;
  readonly errorCode: string | null;
  readonly resetAtMs: number | null;
  readonly kind: AllowanceKind;
}

export interface SiwcAllowanceIngest {
  readonly connectionId: string;
  readonly observation: SiwcAllowanceObservation;
}

const USAGE_CODES = new Set([
  "usage_limit_reached",
  "subscription_sharing_usage_limit_exceeded",
]);

const RATE_CODES = new Set(["rate_limit_exceeded"]);

export class SiwcAllowanceHeaderExtractor {
  extract(
    headers: Iterable<[string, string]> | Readonly<Record<string, string>>,
    body?: string,
    status?: number,
  ): SiwcAllowanceObservation {
    const rateLimits: Record<string, string> = {};
    let retryRaw: string | null = null;
    for (const [name, value] of headerPairs(headers)) {
      const lower = name.toLowerCase();
      if (lower.startsWith("x-ratelimit-") || lower.startsWith("x-chatgpt-")) {
        rateLimits[lower] = value;
      }
      if (lower === "retry-after") retryRaw = value;
    }
    const parsed = readBody(body);
    const retryAfterSeconds = parseRetryAfter(retryRaw);
    const errorCode = parsed.code;
    let kind: AllowanceKind = "ok";
    if (errorCode && USAGE_CODES.has(errorCode)) kind = "usage_limit";
    else if ((errorCode && RATE_CODES.has(errorCode)) || (retryAfterSeconds !== null && status === 429)) kind = "rate_limit";
    else if (errorCode) kind = "other";
    return {
      rateLimits,
      retryAfterSeconds,
      errorCode,
      resetAtMs: parsed.resetAtMs,
      kind,
    };
  }
}

function headerPairs(headers: Iterable<[string, string]> | Readonly<Record<string, string>>): [string, string][] {
  if (typeof (headers as Iterable<[string, string]>)[Symbol.iterator] === "function" && !isHeaderRecord(headers)) {
    return [...(headers as Iterable<[string, string]>)];
  }
  return Object.entries(headers as Readonly<Record<string, string>>);
}

function isHeaderRecord(headers: Iterable<[string, string]> | Readonly<Record<string, string>>): headers is Readonly<Record<string, string>> {
  return typeof headers === "object" && headers !== null && !Array.isArray(headers) && typeof (headers as { forEach?: unknown }).forEach !== "function";
}

function parseRetryAfter(raw: string | null): number | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return null;
  return Math.max(0, (parsed - Date.now()) / 1000);
}

function readBody(body: string | undefined): { code: string | null; resetAtMs: number | null } {
  if (!body) return { code: null, resetAtMs: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return { code: null, resetAtMs: null };
  }
  if (typeof parsed !== "object" || parsed === null) return { code: null, resetAtMs: null };
  const record = parsed as Record<string, unknown>;
  const nested = typeof record["error"] === "object" && record["error"] !== null
    ? record["error"] as Record<string, unknown>
    : null;
  const code = stringCode(nested?.["code"]) ?? stringCode(record["code"]) ?? stringCode(record["error"]);
  const reset = nested?.["reset_at"] ?? record["reset_at"];
  return { code, resetAtMs: readReset(reset) };
}

function stringCode(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readReset(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  if (typeof value === "string" && value.length > 0) {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) return asNumber > 10_000_000_000 ? asNumber : asNumber * 1000;
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}
