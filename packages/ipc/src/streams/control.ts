import { StreamCancelNotificationSchema, StreamCreditGrantSchema } from "@ef-harness/shared-contracts";
import { InvalidStreamRequestError } from "./errors.js";

/**
 * Channel 0 `stream.credit` / `stream.cancel` use the shared-contracts
 * notification params `{ stream_id, credits }` and `{ stream_id, reason? }`.
 * A JSON-RPC id, when the caller is waiting for an error, stays outside that object.
 */
export type ParsedStreamCredit =
  | { readonly ok: true; readonly streamId: number; readonly credits: number }
  | { readonly ok: false; readonly streamId: number | null; readonly credits: number };

/** Schema-valid grants are applied. A dead stream drops even a malformed grant. */
export function parseStreamCredit(params: unknown): ParsedStreamCredit {
  const parsed = StreamCreditGrantSchema.safeParse({
    jsonrpc: "2.0",
    method: "stream.credit",
    params,
  });
  if (parsed.success) {
    return { ok: true, streamId: parsed.data.params.stream_id, credits: parsed.data.params.credits };
  }
  const streamId = streamIdCandidate(params);
  return { ok: false, streamId, credits: creditCandidate(params) };
}

export function parseStreamCancel(params: unknown): { readonly streamId: number; readonly reason?: string } {
  const parsed = StreamCancelNotificationSchema.safeParse({
    jsonrpc: "2.0",
    method: "stream.cancel",
    params,
  });
  if (!parsed.success) {
    throw new InvalidStreamRequestError("stream.cancel requires stream_id");
  }
  const reason = parsed.data.params.reason;
  if (reason === undefined) return { streamId: parsed.data.params.stream_id };
  return { streamId: parsed.data.params.stream_id, reason };
}

function streamIdCandidate(params: unknown): number | null {
  if (typeof params !== "object" || params === null || Array.isArray(params)) return null;
  const streamId = Reflect.get(params, "stream_id");
  return typeof streamId === "number" ? streamId : null;
}

function creditCandidate(params: unknown): number {
  if (typeof params !== "object" || params === null || Array.isArray(params)) return 0;
  const credits = Reflect.get(params, "credits");
  return typeof credits === "number" ? credits : 0;
}
