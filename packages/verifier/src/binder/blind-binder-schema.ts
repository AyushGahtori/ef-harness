import type { BlindBinderOutput, ObservationField } from "./types.js";

const EXPECTATION_KEY = /expected|expectation|oracle|assertion/i;

export interface ParseSuccess {
  ok: true;
  value: BlindBinderOutput;
}

export interface ParseFailure {
  ok: false;
  errors: readonly string[];
}

/**
 * Local port of Task 009 `BlindBinderV1Schema`.
 * Strict object, honest `blocked` exit, and no expected-value keys.
 */
export function parseBlindBinderV1(value: unknown): ParseSuccess | ParseFailure {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["blind-binder output must be an object"] };
  }
  rejectExpectationKeys(value, errors, "");
  if (value["blocked"] === true) {
    return parseBlocked(value, errors);
  }
  return parseSuccess(value, errors);
}

function parseBlocked(
  value: Record<string, unknown>,
  errors: string[],
): ParseSuccess | ParseFailure {
  const allowed = new Set(["blocked", "reason", "missing_ids"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`unexpected property ${key}`);
  }
  if (value["blocked"] !== true) errors.push("blocked must be true");
  const reason = value["reason"];
  if (typeof reason !== "string" || reason.trim().length === 0) {
    errors.push("reason must be non-blank text");
  }
  let missing: string[] | undefined;
  if ("missing_ids" in value) {
    const ids = value["missing_ids"];
    if (!Array.isArray(ids) || ids.some((item) => !isId(item))) {
      errors.push("missing_ids must be an array of ids");
    } else {
      missing = ids.map((item) => item.trim());
    }
  }
  if (errors.length > 0 || typeof reason !== "string") {
    return { ok: false, errors };
  }
  if (missing) {
    return { ok: true, value: { blocked: true, reason: reason.trim(), missing_ids: missing } };
  }
  return { ok: true, value: { blocked: true, reason: reason.trim() } };
}

function parseSuccess(
  value: Record<string, unknown>,
  errors: string[],
): ParseSuccess | ParseFailure {
  const allowed = new Set(["entry_used", "observations_schema"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`unexpected property ${key}`);
  }
  const entryUsed = value["entry_used"];
  if (typeof entryUsed !== "string" || entryUsed.trim().length === 0) {
    errors.push("entry_used must be non-blank text");
  }
  const schema = value["observations_schema"];
  const fields = parseFields(schema, errors);
  if (errors.length > 0 || typeof entryUsed !== "string" || !fields) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      entry_used: entryUsed.trim(),
      observations_schema: { fields },
    },
  };
}

function parseFields(schema: unknown, errors: string[]): ObservationField[] | undefined {
  if (!isRecord(schema)) {
    errors.push("observations_schema must be an object");
    return undefined;
  }
  for (const key of Object.keys(schema)) {
    if (key !== "fields") errors.push(`unexpected property observations_schema.${key}`);
  }
  const fields = schema["fields"];
  if (!Array.isArray(fields)) {
    errors.push("observations_schema.fields must be an array");
    return undefined;
  }
  const parsed: ObservationField[] = [];
  fields.forEach((field, index) => {
    if (!isRecord(field)) {
      errors.push(`observations_schema.fields.${index} must be an object`);
      return;
    }
    for (const key of Object.keys(field)) {
      if (key !== "name" && key !== "type") {
        errors.push(`unexpected property observations_schema.fields.${index}.${key}`);
      }
    }
    const name = field["name"];
    const type = field["type"];
    if (!isId(name)) {
      errors.push(`observations_schema.fields.${index}.name must be an id`);
    } else if (EXPECTATION_KEY.test(name)) {
      errors.push("observation fields cannot name expected values");
    }
    if (typeof type !== "string" || type.trim().length === 0) {
      errors.push(`observations_schema.fields.${index}.type must be non-blank text`);
    }
    if (isId(name) && typeof type === "string" && type.trim().length > 0) {
      parsed.push({ name: name.trim(), type: type.trim() });
    }
  });
  return parsed;
}

function rejectExpectationKeys(value: unknown, errors: string[], path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      rejectExpectationKeys(item, errors, `${path}[${index}]`);
    });
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (EXPECTATION_KEY.test(key)) {
      errors.push(`${path ? `${path}.` : ""}${key} is an expected-value field`);
    }
    rejectExpectationKeys(child, errors, `${path ? `${path}.` : ""}${key}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && !/\s/.test(value);
}

export function observationFieldNames(fields: readonly ObservationField[]): string[] {
  return fields.map((field) => field.name);
}

export function sameObservationFields(
  left: readonly ObservationField[],
  right: readonly ObservationField[],
): boolean {
  if (left.length !== right.length) return false;
  const rightNames = new Set(right.map((field) => field.name));
  return left.every((field) => rightNames.has(field.name));
}
