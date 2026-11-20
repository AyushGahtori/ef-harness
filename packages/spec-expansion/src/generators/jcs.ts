/**
 * RFC 8785 JSON Canonicalization Scheme for the subset matrix keys use:
 * objects, arrays, strings, finite numbers, booleans, and null.
 * Object keys are sorted by UTF-16 code units. Strings are NFC.
 */

type JsonValue = null | boolean | number | string | JsonValue[] | { readonly [key: string]: JsonValue };

export function canonicalizeText(value: string): string {
  if (/^[\u0000-\u007f]*$/.test(value)) return value;
  return value.normalize("NFC");
}

function escapeString(value: string): string {
  const text = canonicalizeText(value);
  let out = '"';
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    const char = text[i] ?? "";
    if (char === '"') out += '\\"';
    else if (char === "\\") out += "\\\\";
    else if (code === 0x08) out += "\\b";
    else if (code === 0x09) out += "\\t";
    else if (code === 0x0a) out += "\\n";
    else if (code === 0x0c) out += "\\f";
    else if (code === 0x0d) out += "\\r";
    else if (code < 0x20) out += `\\u${code.toString(16).padStart(4, "0")}`;
    else out += char;
  }
  return `${out}"`;
}

function canonicalizeNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error("RFC 8785 rejects non-finite numbers");
  }
  if (Object.is(value, -0)) return "0";
  return JSON.stringify(value);
}

export function jcs(value: JsonValue): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return canonicalizeNumber(value);
  if (typeof value === "string") return escapeString(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => jcs(item)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const child = value[key];
    if (child === undefined) continue;
    parts.push(`${escapeString(key)}:${jcs(child)}`);
  }
  return `{${parts.join(",")}}`;
}

const AXIS_TOKEN = /^[^\s:]+$/u;

export function canonicalAxisToken(axis: string): string {
  const normalized = canonicalizeText(axis);
  if (!AXIS_TOKEN.test(normalized) || normalized.includes(":")) {
    throw new Error(`matrix axis is not a canonical token: ${axis}`);
  }
  return normalized;
}

/**
 * Readable cell id required by Task 079.
 * The identity payload is the RFC 8785 encoding of `{a,b,m}`.
 */
export function cellKey(matrixId: string, axisA: string, axisB: string): string {
  return `cell:${fastToken(matrixId)}:${fastToken(axisA)}:${fastToken(axisB)}`;
}

function fastToken(axis: string): string {
  for (let index = 0; index < axis.length; index += 1) {
    const code = axis.charCodeAt(index);
    if (code === 58 || code <= 32 || code > 126) return canonicalAxisToken(axis);
  }
  return axis;
}

export function cellIdentityJcs(matrixId: string, axisA: string, axisB: string): string {
  return jcs({
    a: canonicalAxisToken(axisA),
    b: canonicalAxisToken(axisB),
    m: canonicalAxisToken(matrixId),
  });
}
