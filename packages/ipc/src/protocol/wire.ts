const CANONICAL_EPOCH = /^(?:0|[1-9][0-9]*)$/;

/**
 * `events.subscribe` accepts the shared-contracts number and the canonical
 * integer string stored in `meta.stream_epoch`. Other spellings stay unchanged
 * so the request schema rejects them.
 */
export function prepareRpcRequest(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const record = body as Record<string, unknown>;
  const params = record.params === undefined ? {} : record.params;
  const nextParams = normalizeSubscribeEpoch(record.method, params);
  if (nextParams === params && record.params !== undefined) return body;
  return { ...record, params: nextParams };
}

function normalizeSubscribeEpoch(method: unknown, params: unknown): unknown {
  if (method !== "events.subscribe") return params;
  if (!params || typeof params !== "object" || Array.isArray(params)) return params;
  const record = params as Record<string, unknown>;
  if (!Object.hasOwn(record, "stream_epoch")) return params;
  const epoch = canonicalEpochNumber(record.stream_epoch);
  if (epoch === null || epoch === record.stream_epoch) return params;
  return { ...record, stream_epoch: epoch };
}

export function canonicalEpochNumber(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) return null;
    return value;
  }
  if (typeof value === "string" && CANONICAL_EPOCH.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return null;
}

export function canonicalEpochString(value: number): string {
  return String(value);
}
