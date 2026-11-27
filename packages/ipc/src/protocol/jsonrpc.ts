import { ZodError } from "zod";
import {
  JSON_RPC_INVALID_PARAMS,
  JSON_RPC_INVALID_REQUEST,
  JSON_RPC_PARSE_ERROR,
} from "./constants.js";
import type { DomainEvent, JsonRpcFailure, JsonRpcNotification, JsonRpcSuccess } from "./ports.js";
import { eventsBatchSchema, resyncRequiredSchema, telemetryParamsSchema } from "./schemas.js";

export function notify(method: string, params: unknown): JsonRpcNotification {
  return { jsonrpc: "2.0", method, params };
}

export function success(id: string | number, result: unknown): JsonRpcSuccess {
  return { jsonrpc: "2.0", id, result };
}

export function failure(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcFailure {
  if (data === undefined) {
    return { jsonrpc: "2.0", id, error: { code, message } };
  }
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}

export function zodFailure(id: string | number | null, error: ZodError): JsonRpcFailure {
  return failure(id, JSON_RPC_INVALID_PARAMS, "Invalid params", error.flatten());
}

export type IncomingMessage =
  | {
      readonly ok: true;
      readonly kind: "request";
      readonly id: string | number;
      readonly method: string;
      readonly params: unknown;
      readonly body: unknown;
    }
  | { readonly ok: true; readonly kind: "notification"; readonly method: string; readonly params: unknown }
  | { readonly ok: false; readonly response: JsonRpcFailure };

export function parseIncoming(payload: unknown): IncomingMessage {
  let value = payload;
  if (typeof payload === "string") {
    try {
      value = JSON.parse(payload) as unknown;
    } catch {
      return { ok: false, response: failure(null, JSON_RPC_PARSE_ERROR, "Parse error") };
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, response: failure(null, JSON_RPC_INVALID_REQUEST, "Invalid request") };
  }
  const record = value as Record<string, unknown>;
  if (record.jsonrpc !== "2.0" || typeof record.method !== "string" || record.method.length === 0) {
    return { ok: false, response: failure(requestId(record), JSON_RPC_INVALID_REQUEST, "Invalid request") };
  }
  if (record.params !== undefined && (typeof record.params !== "object" || record.params === null || Array.isArray(record.params))) {
    return { ok: false, response: failure(requestId(record), JSON_RPC_INVALID_PARAMS, "Invalid params") };
  }
  const params = record.params === undefined ? {} : record.params;
  if (!Object.hasOwn(record, "id")) {
    return { ok: true, kind: "notification", method: record.method, params };
  }
  const id = record.id;
  if (typeof id !== "string" && (typeof id !== "number" || !Number.isInteger(id))) {
    return { ok: false, response: failure(null, JSON_RPC_INVALID_REQUEST, "Invalid request") };
  }
  return { ok: true, kind: "request", id, method: record.method, params, body: record };
}

function requestId(record: Record<string, unknown>): string | number | null {
  if (typeof record.id === "string" || (typeof record.id === "number" && Number.isInteger(record.id))) {
    return record.id;
  }
  return null;
}

export type DecodedDaemonMessage =
  | { readonly kind: "response"; readonly id: string | number; readonly result: unknown }
  | { readonly kind: "error"; readonly id: string | number | null; readonly error: { readonly code: number; readonly message: string } }
  | { readonly kind: "events.batch"; readonly batch: { readonly from_seq: number; readonly to_seq: number; readonly events: readonly { readonly seq: number; readonly id: string; readonly type: string; readonly payload: unknown; readonly topic?: string }[] } }
  | { readonly kind: "telemetry"; readonly params: { readonly project: string; readonly kind: string; readonly payload: unknown } }
  | { readonly kind: "resync_required"; readonly current_stream_epoch: string; readonly latest_seq: number }
  | { readonly kind: "notification"; readonly method: string; readonly params: unknown }
  | { readonly kind: "invalid" };

/**
 * Client decoder for daemon messages. Unknown additive fields pass Zod
 * validation and are ignored. Unknown methods are ignored, not rejected.
 */
export function decodeDaemonMessage(input: unknown): DecodedDaemonMessage {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { kind: "invalid" };
  const record = input as Record<string, unknown>;
  if (record.jsonrpc !== "2.0") return { kind: "invalid" };
  if (typeof record.method === "string") {
    if (record.method === "events.batch") {
      const parsed = eventsBatchSchema.safeParse(record.params);
      if (!parsed.success) return { kind: "invalid" };
      return {
        kind: "events.batch",
        batch: {
          from_seq: parsed.data.from_seq,
          to_seq: parsed.data.to_seq,
          events: parsed.data.events.map((event) => toDomainEvent(event)),
        },
      };
    }
    if (record.method === "telemetry") {
      const parsed = telemetryParamsSchema.safeParse(record.params);
      if (!parsed.success) return { kind: "invalid" };
      return {
        kind: "telemetry",
        params: {
          project: parsed.data.project,
          kind: parsed.data.kind,
          payload: parsed.data.payload,
        },
      };
    }
    if (record.method === "resync_required") {
      const parsed = resyncRequiredSchema.safeParse(record.params ?? record);
      if (!parsed.success) return { kind: "notification", method: record.method, params: record.params };
      return {
        kind: "resync_required",
        current_stream_epoch: parsed.data.current_stream_epoch,
        latest_seq: parsed.data.latest_seq,
      };
    }
    return { kind: "notification", method: record.method, params: record.params };
  }
  const id = record.id;
  const validId = typeof id === "string" || (typeof id === "number" && Number.isInteger(id));
  if ("error" in record && record.error && typeof record.error === "object") {
    const error = record.error as Record<string, unknown>;
    if (typeof error.code === "number" && typeof error.message === "string") {
      return {
        kind: "error",
        id: validId ? id : null,
        error: { code: error.code, message: error.message },
      };
    }
    return { kind: "invalid" };
  }
  if ("result" in record && validId) {
    return { kind: "response", id, result: record.result };
  }
  return { kind: "invalid" };
}

function toDomainEvent(event: {
  seq: number;
  id: string;
  type: string;
  payload?: unknown;
  topic?: string | undefined;
  subject?: string | null | undefined;
  rev?: number | null | undefined;
  createdAt?: number | undefined;
}): DomainEvent {
  return {
    seq: event.seq,
    id: event.id,
    type: event.type,
    payload: event.payload,
    ...(event.topic !== undefined ? { topic: event.topic } : {}),
    ...(event.subject !== undefined ? { subject: event.subject } : {}),
    ...(event.rev !== undefined ? { rev: event.rev } : {}),
    ...(event.createdAt !== undefined ? { createdAt: event.createdAt } : {}),
  };
}
