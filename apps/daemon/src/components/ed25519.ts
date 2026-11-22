import { createPublicKey, sign, verify, type KeyObject } from "node:crypto";

export function ed25519PublicKey(raw: Uint8Array): KeyObject {
  return createPublicKey({
    key: {
      kty: "OKP",
      crv: "Ed25519",
      x: Buffer.from(raw).toString("base64url"),
    },
    format: "jwk",
  });
}

export function verifyEd25519(publicKeyRaw: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  if (publicKeyRaw.byteLength !== 32 || signature.byteLength !== 64) return false;
  return verify(null, message, ed25519PublicKey(publicKeyRaw), signature);
}

export function signEd25519(privateKey: KeyObject, message: Uint8Array): Buffer {
  return sign(null, message, privateKey);
}
