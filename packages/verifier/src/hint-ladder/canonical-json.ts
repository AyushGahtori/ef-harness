import { createHash } from "node:crypto";
import { HintLadderError } from "./errors.js";

export function canonicalizeJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function localNodeContentHash(parts: {
  readonly kind: string;
  readonly title: string;
  readonly text: string;
  readonly fields: Record<string, unknown>;
}): string {
  const canonical = canonicalizeJson(parts);
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

export function parseJsonObject(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value)) throw new HintLadderError("expected a JSON object");
  return value;
}

export function parseStringArray(text: string): string[] {
  const value: unknown = JSON.parse(text);
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new HintLadderError("expected a JSON array of strings");
  }
  return value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sortValue(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new HintLadderError("non-finite number in canonical json");
    if (Object.is(value, -0)) return 0;
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => sortValue(item));
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const inner = value[key];
      if (inner === undefined) continue;
      out[key] = sortValue(inner);
    }
    return out;
  }
  throw new HintLadderError("unsupported canonical json value");
}
