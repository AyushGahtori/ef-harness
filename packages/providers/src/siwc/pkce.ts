import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function base64Url(bytes: Buffer): string {
  return bytes.toString("base64url");
}

export function pkceS256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function createPkceVerifier(size = 32): string {
  const verifier = base64Url(randomBytes(size));
  if (verifier.length < 43 || verifier.length > 128) {
    throw new Error("PKCE verifier length is outside RFC 7636");
  }
  return verifier;
}

export function createOAuthEntropy(size = 32): string {
  return base64Url(randomBytes(size));
}

export function timingSafeEqualString(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  if (leftBytes.length !== rightBytes.length) {
    const filler = Buffer.alloc(leftBytes.length);
    timingSafeEqual(leftBytes, filler);
    return false;
  }
  return timingSafeEqual(leftBytes, rightBytes);
}

export function grantedScopeList(scopeField: string): string[] {
  return scopeField.split(/[\s+]+/).map((part) => part.trim()).filter((part) => part.length > 0);
}
