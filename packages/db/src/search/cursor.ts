import { InvalidCursorError } from "./errors.js";

const CURSOR_VERSION = 1;

/** Opaque base64 keyset. The only payload is the last `nodes.nid`. */
export function encodeKeysetCursor(nid: number): string {
  if (!Number.isSafeInteger(nid) || nid < 1) {
    throw new InvalidCursorError("keyset cursor requires a positive nid");
  }
  return Buffer.from(JSON.stringify({ v: CURSOR_VERSION, nid }), "utf8").toString("base64url");
}

/** Reject tampered cursors. A cursor whose node was retired is still well-formed. */
export function decodeKeysetCursor(cursor: string): number {
  if (typeof cursor !== "string" || cursor.length === 0 || cursor.length > 512) {
    throw new InvalidCursorError();
  }
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(cursor)) {
    throw new InvalidCursorError();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new InvalidCursorError();
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new InvalidCursorError();
  }
  const record = parsed as Record<string, unknown>;
  const nid = record.nid;
  if (record.v !== CURSOR_VERSION || typeof nid !== "number" || !Number.isSafeInteger(nid) || nid < 1) {
    throw new InvalidCursorError();
  }
  return nid;
}
