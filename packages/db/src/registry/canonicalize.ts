import { InvalidNameKindError, InvalidNameValueError } from "./errors.js";
import {
  isNameKind,
  isRouteNameKind,
  type NameKind,
  type RouteNameKind,
} from "./name-kinds.js";
import { RouteSegmentParser, type RouteSegment } from "./route-segment-parser.js";

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const parser = new RouteSegmentParser();

export interface StoredName {
  kind: NameKind;
  value: string;
  explicitOrder?: boolean;
}

export function canonicalizeName(kind: NameKind, value: string): string {
  if (typeof value !== "string" || value.length > 512) {
    throw new InvalidNameValueError(kind, String(value));
  }
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) throw new InvalidNameValueError(kind, value);
  if (isRouteNameKind(kind)) return parser.canonicalize(trimmed, kind);
  if (kind === "env_var") {
    if (!IDENTIFIER.test(trimmed)) throw new InvalidNameValueError(kind, value);
    return trimmed.toUpperCase();
  }
  if (kind === "db_table" || kind === "db_index" || kind === "db_constraint") {
    if (!IDENTIFIER.test(trimmed)) throw new InvalidNameValueError(kind, value);
    return trimmed.toLowerCase();
  }
  if (kind === "db_column") {
    const parts = trimmed.split(".");
    if (parts.length !== 2 || !parts.every((part) => IDENTIFIER.test(part))) {
      throw new InvalidNameValueError(kind, value);
    }
    return `${parts[0]?.toLowerCase() ?? ""}.${parts[1]?.toLowerCase() ?? ""}`;
  }
  return trimmed;
}

export function canonicalizePrefix(kind: NameKind, prefix: string): string {
  if (typeof prefix !== "string" || prefix.includes("*")) {
    throw new InvalidNameValueError(kind, String(prefix));
  }
  if (isRouteNameKind(kind)) {
    const parsed = parser.parse(prefix, kind);
    if (parsed.segments.some((segment) => segment.type !== "static")) {
      throw new InvalidNameValueError(kind, prefix);
    }
    return parsed.canonical;
  }
  const trimmed = prefix.trim();
  if (!trimmed || /[\s*?]/.test(trimmed)) throw new InvalidNameValueError(kind, prefix);
  if (kind === "env_var") return trimmed.toUpperCase();
  if (kind === "db_table" || kind === "db_column" || kind === "db_index" || kind === "db_constraint") {
    return trimmed.toLowerCase();
  }
  return trimmed;
}

export function prefixCovers(kind: NameKind, prefix: string, value: string): boolean {
  const canonicalPrefix = canonicalizePrefix(kind, prefix);
  const canonicalValue = isRouteNameKind(kind)
    ? parser.canonicalize(value, kind)
    : canonicalizeName(kind, value);
  if (isRouteNameKind(kind)) return routePrefixCovers(canonicalPrefix, canonicalValue, kind);
  return literalPrefixCovers(canonicalPrefix, canonicalValue);
}

export function namesMatch(kind: NameKind, stored: string, canonical: string): boolean {
  try {
    return canonicalizeName(kind, stored) === canonical;
  } catch (error) {
    if (!(error instanceof InvalidNameValueError)) throw error;
    return stored === canonical;
  }
}

export function parseNameList(value: unknown): StoredName[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new InvalidNameValueError("names", "names must be an array");
  return value.map((entry, index) => parseNameEntry(entry, index));
}

function parseNameEntry(entry: unknown, index: number): StoredName {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new InvalidNameValueError("names", `entry ${String(index)} must be an object`);
  }
  const record = entry as Record<string, unknown>;
  const kindValue = record["kind"];
  const rawValue = record["value"];
  if (typeof kindValue !== "string" || !isNameKind(kindValue)) {
    throw new InvalidNameKindError(typeof kindValue === "string" ? kindValue : typeof kindValue);
  }
  if (typeof rawValue !== "string") {
    throw new InvalidNameValueError(kindValue, `entry ${String(index)} value must be a string`);
  }
  const stored: StoredName = { kind: kindValue, value: canonicalizeName(kindValue, rawValue) };
  const explicit = record["explicitOrder"];
  if (explicit !== undefined && typeof explicit !== "boolean") {
    throw new InvalidNameValueError(kindValue, "explicitOrder must be a boolean");
  }
  if (explicit === true) stored.explicitOrder = true;
  return stored;
}

function routePrefixCovers(prefix: string, value: string, kind: RouteNameKind): boolean {
  const prefixSegments = parser.parse(prefix, kind).segments;
  const valueSegments = parser.parse(value, kind).segments;
  if (prefixSegments.some((segment) => segment.type !== "static")) return false;
  if (valueSegments.length < prefixSegments.length) return false;
  for (let index = 0; index < prefixSegments.length; index += 1) {
    const prefixSegment = prefixSegments[index];
    const valueSegment = valueSegments[index];
    if (!prefixSegment || !valueSegment) return false;
    if (!staticEqual(prefixSegment, valueSegment)) return false;
  }
  return true;
}

function staticEqual(prefixSegment: RouteSegment, valueSegment: RouteSegment): boolean {
  return (
    prefixSegment.type === "static" &&
    valueSegment.type === "static" &&
    prefixSegment.value === valueSegment.value
  );
}

function literalPrefixCovers(prefix: string, value: string): boolean {
  if (value === prefix) return true;
  if (
    prefix.endsWith(":") ||
    prefix.endsWith(".") ||
    prefix.endsWith("_") ||
    prefix.endsWith("/")
  ) {
    return value.startsWith(prefix);
  }
  if (!value.startsWith(prefix)) return false;
  const next = value[prefix.length];
  return next === ":" || next === "." || next === "_" || next === "/" || next === "*";
}
