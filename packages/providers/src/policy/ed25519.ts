import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { signedPayloadBytes } from "./canonical.js";
import { PINNED_POLICY_KEY_ID, pinnedPolicyPublicKey } from "./pinned-key.js";
import type { PolicySignature, ProviderPolicyDocument, UnsignedProviderPolicy } from "./types.js";

const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function signBytes(message: Buffer, seed: Uint8Array): Buffer {
  if (seed.byteLength !== 32) {
    throw new Error("Ed25519 seed must be 32 bytes");
  }
  const privateKey = createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, Buffer.from(seed)]),
    format: "der",
    type: "pkcs8",
  });
  return sign(null, message, privateKey);
}

export function verifyBytes(message: Buffer, signature: Buffer, publicKeyRaw: Buffer): boolean {
  if (publicKeyRaw.byteLength !== 32 || signature.byteLength !== 64) return false;
  const publicKey = createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, publicKeyRaw]),
    format: "der",
    type: "spki",
  });
  return verify(null, message, publicKey, signature);
}

export function signPolicyDocument(
  unsigned: UnsignedProviderPolicy,
  seed: Uint8Array,
): ProviderPolicyDocument {
  const record = unsigned as unknown as Record<string, unknown>;
  const payload = signedPayloadBytes(record);
  const signature: PolicySignature = {
    alg: "Ed25519",
    keyId: PINNED_POLICY_KEY_ID,
    sig: signBytes(payload, seed).toString("base64"),
  };
  return { ...unsigned, signature };
}

export function verifyPinnedSignature(record: Record<string, unknown>): {
  ok: boolean;
  bytes: Buffer;
  sha256: string;
} {
  const bytes = signedPayloadBytes(record);
  const sha256 = sha256Hex(bytes);
  const signature = record.signature;
  if (!signature || typeof signature !== "object" || Array.isArray(signature)) {
    return { ok: false, bytes, sha256 };
  }
  const fields = signature as Record<string, unknown>;
  if (fields.alg !== "Ed25519" || fields.keyId !== PINNED_POLICY_KEY_ID) {
    return { ok: false, bytes, sha256 };
  }
  if (typeof fields.sig !== "string" || fields.sig.length === 0) {
    return { ok: false, bytes, sha256 };
  }
  const decoded = Buffer.from(fields.sig, "base64");
  const ok = verifyBytes(bytes, decoded, pinnedPolicyPublicKey());
  return { ok, bytes, sha256 };
}
