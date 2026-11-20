const SENSITIVE_HEADERS = new Map<string, string>([
  ["authorization", "AUTHORIZATION"],
  ["cookie", "COOKIE"],
  ["set-cookie", "SET_COOKIE"],
  ["x-api-key", "X_API_KEY"],
]);

export function sensitiveHeaderLabel(name: string): string | undefined {
  return SENSITIVE_HEADERS.get(name.toLowerCase());
}

export function sanitizeForLog(value: unknown, redactText: (text: string) => string): unknown {
  return walk(value, redactText, new WeakSet<object>());
}

function walk(
  value: unknown,
  redactText: (text: string) => string,
  seen: WeakSet<object>,
): unknown {
  if (value === null) return null;
  if (typeof value === "string") return redactText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return redactText(String(value));
  if (typeof value === "undefined") return undefined;
  if (typeof value === "function") return "[Function]";
  if (typeof value === "symbol") return "[Symbol]";
  if (typeof value !== "object") return redactText(String(value));
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (value instanceof Date) {
    const rendered = Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString();
    return redactText(rendered);
  }
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
    return { type: "Buffer", byteLength: value.byteLength };
  }
  if (value instanceof ArrayBuffer) {
    return { type: "ArrayBuffer", byteLength: value.byteLength };
  }
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    return { type: value.constructor.name || "TypedArray", byteLength: value.byteLength };
  }
  if (value instanceof Error) return sanitizeError(value, redactText, seen);
  if (value instanceof RegExp) return redactText(String(value));
  if (value instanceof Map) return sanitizeMap(value, redactText, seen);
  if (value instanceof Set) return [...value].map((entry) => walk(entry, redactText, seen) ?? null);
  if (Array.isArray(value)) {
    return value.map((entry) => walk(entry, redactText, seen) ?? null);
  }
  return sanitizeObject(value, redactText, seen);
}

function sanitizeError(
  error: Error,
  redactText: (text: string) => string,
  seen: WeakSet<object>,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {
    name: redactText(error.name),
    message: redactText(error.message),
  };
  if (typeof error.stack === "string") sanitized.stack = redactText(error.stack);
  if (error.cause !== undefined) sanitized.cause = walk(error.cause, redactText, seen);
  if (error instanceof AggregateError) {
    sanitized.errors = error.errors.map((entry) => walk(entry, redactText, seen) ?? null);
  }
  return sanitized;
}

function sanitizeMap(
  map: Map<unknown, unknown>,
  redactText: (text: string) => string,
  seen: WeakSet<object>,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, entry] of map) {
    const rendered = typeof key === "string" ? key : key === undefined ? "undefined" : String(key);
    sanitized[redactText(rendered)] = walk(entry, redactText, seen);
  }
  return sanitized;
}

function sanitizeObject(
  value: object,
  redactText: (text: string) => string,
  seen: WeakSet<object>,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const header = sensitiveHeaderLabel(key);
    if (header) {
      sanitized[redactText(key)] = `[REDACTED:${header}]`;
      continue;
    }
    if (key.toLowerCase() === "headers" && Array.isArray(entry)) {
      sanitized[redactText(key)] = entry.map((item) => sanitizeHeaderPair(item, redactText, seen));
      continue;
    }
    const walked = walk(entry, redactText, seen);
    if (walked !== undefined) sanitized[redactText(key)] = walked;
  }
  return sanitized;
}

function sanitizeHeaderPair(
  item: unknown,
  redactText: (text: string) => string,
  seen: WeakSet<object>,
): unknown {
  if (!Array.isArray(item) || typeof item[0] !== "string") return walk(item, redactText, seen) ?? null;
  const header = sensitiveHeaderLabel(item[0]);
  if (!header) return walk(item, redactText, seen) ?? null;
  const copy: unknown[] = [item[0], `[REDACTED:${header}]`];
  for (let index = 2; index < item.length; index += 1) {
    copy.push(walk(item[index], redactText, seen) ?? null);
  }
  return copy;
}
