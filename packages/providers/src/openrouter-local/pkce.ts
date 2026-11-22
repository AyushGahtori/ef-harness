import { createHash, randomBytes } from "node:crypto";

const VERIFIER_BYTES = 32;

export interface PkcePair {
  readonly verifier: string;
  readonly challenge: string;
  readonly method: "S256";
}

export function createPkcePair(bytes: (size: number) => Buffer = randomBytes): PkcePair {
  const verifier = bytes(VERIFIER_BYTES).toString("base64url");
  return {
    verifier,
    challenge: codeChallengeS256(verifier),
    method: "S256",
  };
}

export function codeChallengeS256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function isPkceVerifier(value: string): boolean {
  return /^[A-Za-z0-9\-._~]{43,128}$/.test(value);
}
