import type { LengthUnit } from "./types.js";

export function measureText(text: string, unit: LengthUnit): number {
  if (unit === "utf8_bytes") return Buffer.byteLength(text, "utf8");
  if (unit === "utf16_code_units") return text.length;
  return Array.from(text).length;
}

export function fitString(
  desired: string,
  max: number | undefined,
  unit: LengthUnit,
  exact: boolean,
): string {
  const normalized = desired.normalize("NFC");
  if (max === undefined) {
    if (!exact) return normalized;
    const target = Math.max(measureText(normalized, unit), 32);
    return padTo(normalized, target, unit);
  }
  if (max <= 0) return "";
  let out = "";
  for (const char of normalized) {
    if (measureText(out + char, unit) > max) break;
    out += char;
  }
  if (!exact) return out;
  return padTo(out, max, unit);
}

function padTo(value: string, max: number, unit: LengthUnit): string {
  let out = value;
  while (measureText(out + "M", unit) <= max) {
    out += "M";
  }
  return out;
}

export interface ParsedType {
  readonly family: "int" | "real" | "text" | "bool" | "blob" | "timestamp";
  readonly maxLength?: number;
  readonly precision?: number;
  readonly scale?: number;
}

export function parseColumnType(raw: string): ParsedType {
  const trimmed = raw.trim().toLowerCase().replace(/\s+/g, " ");
  const match = /^([a-z ]+?)(?:\((\d+)\s*(?:,\s*(\d+))?\))?$/.exec(trimmed);
  const base = (match?.[1] ?? trimmed).trim();
  const first = match?.[2] !== undefined ? Number(match[2]) : undefined;
  const second = match?.[3] !== undefined ? Number(match[3]) : undefined;
  const family = familyOf(base);
  if (family === "text" && first !== undefined) {
    return { family, maxLength: first };
  }
  if (family === "real" && first !== undefined) {
    return {
      family,
      precision: first,
      ...(second !== undefined ? { scale: second } : {}),
    };
  }
  return { family };
}

function familyOf(base: string): ParsedType["family"] {
  if (base.includes("bool")) return "bool";
  if (base.includes("blob") || base.includes("bytea")) return "blob";
  if (
    base.includes("timestamp") ||
    base.includes("datetime") ||
    base === "date" ||
    base.includes("time")
  ) {
    return "timestamp";
  }
  if (
    base.includes("int") ||
    base.includes("serial") ||
    base === "year"
  ) {
    return "int";
  }
  if (
    base.includes("real") ||
    base.includes("floa") ||
    base.includes("doub") ||
    base.includes("num") ||
    base.includes("dec") ||
    base.includes("money")
  ) {
    return "real";
  }
  return "text";
}

export interface BoundFacts {
  readonly min?: number;
  readonly max?: number;
  readonly maxLength?: number;
  readonly lengthUnit?: LengthUnit;
  readonly allowedValues?: readonly string[];
}

export function parseCheckExpression(expression: string, column?: string): BoundFacts {
  let min: number | undefined;
  let max: number | undefined;
  let maxLength: number | undefined;
  let lengthUnit: LengthUnit | undefined;
  let allowedValues: readonly string[] | undefined;
  const applies = (name: string | undefined): boolean =>
    column === undefined || name?.toLowerCase() === column.toLowerCase();

  const between =
    /\b([a-zA-Z_][a-zA-Z0-9_]*)\s+BETWEEN\s+(-?\d+(?:\.\d+)?)\s+AND\s+(-?\d+(?:\.\d+)?)/gi;
  for (const match of expression.matchAll(between)) {
    if (!applies(match[1]) || match[2] === undefined || match[3] === undefined) continue;
    min = Number(match[2]);
    max = Number(match[3]);
  }

  const comparisons = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*(>=|<=|>|<)\s*(-?\d+(?:\.\d+)?)/gi;
  for (const match of expression.matchAll(comparisons)) {
    if (!applies(match[1])) continue;
    const op = match[2];
    const raw = match[3];
    if (op === undefined || raw === undefined) continue;
    const value = Number(raw);
    if (op === ">=") min = min === undefined ? value : Math.max(min, value);
    if (op === ">") min = min === undefined ? value + 1 : Math.max(min, value + 1);
    if (op === "<=") max = max === undefined ? value : Math.min(max, value);
    if (op === "<") max = max === undefined ? value - 1 : Math.min(max, value - 1);
  }

  const length =
    /\b(octet_length|char_length|character_length|length)\s*\(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)\s*(<=|<|=)\s*(\d+)/gi;
  for (const match of expression.matchAll(length)) {
    if (!applies(match[2]) || match[1] === undefined || match[4] === undefined) continue;
    const kind = match[1].toLowerCase();
    const limit = Number(match[4]);
    maxLength = match[3] === "<" ? limit - 1 : limit;
    lengthUnit = kind === "octet_length" ? "utf8_bytes" : "code_points";
  }

  const list = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s+IN\s*\(([^)]*)\)/gi;
  for (const match of expression.matchAll(list)) {
    if (!applies(match[1]) || match[2] === undefined) continue;
    const values: string[] = [];
    for (const quoted of match[2].matchAll(/'([^']*)'|"([^"]*)"/g)) {
      values.push(quoted[1] ?? quoted[2] ?? "");
    }
    if (values.length > 0) allowedValues = values;
  }

  return {
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
    ...(maxLength !== undefined ? { maxLength } : {}),
    ...(lengthUnit !== undefined ? { lengthUnit } : {}),
    ...(allowedValues !== undefined ? { allowedValues } : {}),
  };
}
