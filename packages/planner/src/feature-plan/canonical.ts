import { createHash } from "node:crypto";

import { FeaturePlanError } from "./errors.js";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,80}$/;

export function assertId(value: string, label: string): string {
  if (!ID_PATTERN.test(value)) {
    throw new FeaturePlanError("invalid_id", `${label} is not a canonical node id`, { id: value });
  }
  return value;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortValue(item));
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortValue(record[key]);
    }
    return sorted;
  }
  return value;
}

export function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FeaturePlanError("invalid_model_output", `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function assertExactKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new FeaturePlanError("invalid_model_output", `${label} has unknown key ${key}`, { key });
    }
  }
}

export function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new FeaturePlanError("invalid_model_output", `${label} must be a non-empty string`);
  }
  return value;
}

export function optionalString(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new FeaturePlanError("invalid_model_output", `${label} must be a string or null`);
  }
  return value;
}

export function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    throw new FeaturePlanError("invalid_model_output", `${label} must be an array of non-empty strings`);
  }
  return value;
}

export function readStringArray(fields: Readonly<Record<string, unknown>>, key: string): string[] {
  const value = fields[key];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new FeaturePlanError("invalid_relation", `${key} must be an array of node ids`, { key });
  }
  return value;
}
