import type { SqlValue } from "./connection.js";
import { InvalidOutboxEventError } from "./errors.js";
import type { StoredOutboxEvent } from "./types.js";

export function readRequiredInt(value: SqlValue | undefined, field: string): number {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new InvalidOutboxEventError(`outbox ${field} is not a safe integer`);
    }
    return value;
  }
  if (typeof value === "bigint") {
    const asNumber = Number(value);
    if (!Number.isSafeInteger(asNumber)) {
      throw new InvalidOutboxEventError(`outbox ${field} is not a safe integer`);
    }
    return asNumber;
  }
  throw new InvalidOutboxEventError(`outbox ${field} is missing`);
}

export function readOptionalInt(value: SqlValue | undefined, field: string): number | null {
  if (value === null || value === undefined) return null;
  return readRequiredInt(value, field);
}

export function readRequiredText(value: SqlValue | undefined, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new InvalidOutboxEventError(`outbox ${field} is missing`);
  }
  return value;
}

export function readOptionalText(value: SqlValue | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new InvalidOutboxEventError("outbox text column has an unexpected type");
  }
  return value;
}

export function encodePayload(payload: unknown): string {
  if (payload === undefined) return "{}";
  try {
    const json = JSON.stringify(payload);
    if (json === undefined) {
      throw new InvalidOutboxEventError("outbox payload is not JSON-serializable");
    }
    return json;
  } catch (error) {
    if (error instanceof InvalidOutboxEventError) throw error;
    throw new InvalidOutboxEventError("outbox payload is not JSON-serializable");
  }
}

export function decodePayload(value: SqlValue | undefined): unknown {
  if (typeof value !== "string") {
    throw new InvalidOutboxEventError("outbox payload is missing");
  }
  return JSON.parse(value) as unknown;
}

export function readStoredEvent(row: Record<string, SqlValue>): StoredOutboxEvent {
  return {
    seq: readRequiredInt(row.seq, "seq"),
    id: readRequiredText(row.id, "id"),
    type: readRequiredText(row.type, "type"),
    subject: readOptionalText(row.subject),
    rev: readOptionalInt(row.rev, "rev"),
    payload: decodePayload(row.payload),
    createdAt: readRequiredInt(row.created_at, "created_at"),
  };
}

export function changeCount(changes: number | bigint): number {
  return typeof changes === "bigint" ? Number(changes) : changes;
}
