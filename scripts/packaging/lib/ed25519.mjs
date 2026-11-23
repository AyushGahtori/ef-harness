import crypto from "node:crypto";

export function ed25519PublicKey(raw) {
  return crypto.createPublicKey({
    key: {
      kty: "OKP",
      crv: "Ed25519",
      x: Buffer.from(raw).toString("base64url"),
    },
    format: "jwk",
  });
}

export function verifyEd25519(publicKeyRaw, message, signature) {
  if (publicKeyRaw.byteLength !== 32 || signature.byteLength !== 64) return false;
  return crypto.verify(null, message, ed25519PublicKey(publicKeyRaw), signature);
}

export function signEd25519(privateKey, message) {
  return crypto.sign(null, message, privateKey);
}

export function exportEd25519PublicKeyRaw(publicKey) {
  const jwk = publicKey.export({ format: "jwk" });
  return Buffer.from(jwk.x, "base64url");
}