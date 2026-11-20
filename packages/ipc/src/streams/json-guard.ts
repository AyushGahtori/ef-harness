import { JSON_RPC_MAX_BYTES } from "./constants.js";
import { PayloadExceedsJsonCapError, spillToArtifactOpen, type ArtifactSpillHint } from "./errors.js";

/** Reject a Channel 0 body that would exceed the 1 MB JSON-RPC cap. */
export function assertJsonRpcWithinCap(byteLength: number): void {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > JSON_RPC_MAX_BYTES) {
    throw new PayloadExceedsJsonCapError(Math.max(0, Number.isFinite(byteLength) ? byteLength : 0));
  }
}

/** @see assertJsonRpcWithinCap */
export function assertJsonPayloadWithinCap(byteLength: number): void {
  assertJsonRpcWithinCap(byteLength);
}

export function assertJsonValueWithinCap(value: unknown): void {
  assertJsonRpcWithinCap(jsonByteLength(value));
}

export function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? "null", "utf8");
}

/** Encode a Channel 0 JSON body, or refuse it when it cannot fit in the cap. */
export function encodeJsonPayload(value: unknown): Uint8Array {
  const encoded = Buffer.from(JSON.stringify(value) ?? "null", "utf8");
  assertJsonRpcWithinCap(encoded.byteLength);
  return encoded;
}

/** @see spillToArtifactOpen */
export function artifactOpenSpillover(byteLength: number): ArtifactSpillHint {
  return spillToArtifactOpen(byteLength);
}
