import { createPublicKey, createSign, createVerify, type KeyObject } from "node:crypto";
import { SiwcError, SiwcNonceRejectedError } from "./errors.js";
import type { FetchLike } from "./ports.js";

export interface RsaJwk {
  readonly kty: "RSA";
  readonly n: string;
  readonly e: string;
  readonly kid?: string;
  readonly alg?: string;
  readonly use?: string;
}

export interface IdTokenChecks {
  readonly issuer: string;
  readonly audience: string;
  readonly nonce: string | null;
  readonly nowMs: number;
}

export interface VerifiedIdToken {
  readonly iss: string;
  readonly aud: string;
  readonly sub: string;
  readonly exp: number;
  readonly email: string | null;
  readonly nonce: string | null;
}

interface JwtHeader {
  readonly alg?: unknown;
  readonly kid?: unknown;
}

export function signRs256Jwt(
  privateKey: KeyObject,
  payload: Readonly<Record<string, string | number>>,
  kid: string,
): string {
  const header = base64UrlJson({ alg: "RS256", typ: "JWT", kid });
  const body = base64UrlJson(payload);
  const signingInput = `${header}.${body}`;
  const signature = createSign("RSA-SHA256").update(signingInput).end().sign(privateKey);
  return `${signingInput}.${signature.toString("base64url")}`;
}

export async function fetchJwk(
  jwksUri: string,
  kid: string | null,
  fetchImpl: FetchLike,
): Promise<RsaJwk> {
  const response = await fetchImpl(jwksUri);
  if (!response.ok) {
    throw new SiwcError("jwks_unavailable", "ChatGPT signing keys could not be loaded.");
  }
  const body: unknown = await response.json();
  const keys = readKeys(body);
  const match = kid ? keys.find((key) => key.kid === kid) : keys[0];
  if (!match) {
    throw new SiwcError("jwks_kid", "ChatGPT signing keys did not include this token.");
  }
  return match;
}

export async function verifyIdToken(
  token: string,
  jwksUri: string,
  checks: IdTokenChecks,
  fetchImpl: FetchLike,
): Promise<VerifiedIdToken> {
  if (token.length > 20_000) {
    throw new SiwcError("id_token", "The identity token was rejected.");
  }
  const parts = token.split(".");
  const encodedHeader = parts[0];
  const encodedPayload = parts[1];
  const encodedSignature = parts[2];
  if (!encodedHeader || !encodedPayload || !encodedSignature || parts.length !== 3) {
    throw new SiwcError("id_token", "The identity token was rejected.");
  }
  const header = parseJson(encodedHeader) as JwtHeader;
  if (header.alg !== "RS256") {
    throw new SiwcError("id_token", "The identity token was rejected.");
  }
  const kid = typeof header.kid === "string" ? header.kid : null;
  const jwk = await fetchJwk(jwksUri, kid, fetchImpl);
  const key = createPublicKey({ key: { kty: "RSA", n: jwk.n, e: jwk.e }, format: "jwk" });
  const verified = createVerify("RSA-SHA256")
    .update(`${encodedHeader}.${encodedPayload}`)
    .verify(key, Buffer.from(encodedSignature, "base64url"));
  if (!verified) {
    throw new SiwcError("id_token", "The identity token signature did not verify.");
  }
  return readClaims(parseJson(encodedPayload), checks);
}

function readClaims(payload: unknown, checks: IdTokenChecks): VerifiedIdToken {
  if (typeof payload !== "object" || payload === null) {
    throw new SiwcError("id_token", "The identity token was rejected.");
  }
  const record = payload as Record<string, unknown>;
  const iss = readString(record, "iss");
  const sub = readString(record, "sub");
  const exp = record["exp"];
  const nonce = typeof record["nonce"] === "string" ? record["nonce"] : null;
  const email = typeof record["email"] === "string" ? record["email"] : null;
  if (!iss || !sub || typeof exp !== "number" || !Number.isFinite(exp)) {
    throw new SiwcError("id_token", "The identity token was rejected.");
  }
  if (iss !== checks.issuer) {
    throw new SiwcError("id_token_iss", "The identity token issuer was not accepted.");
  }
  const aud = record["aud"];
  const audiences = typeof aud === "string" ? [aud] : Array.isArray(aud) ? aud.filter((item) => typeof item === "string") : [];
  if (!audiences.includes(checks.audience)) {
    throw new SiwcError("id_token_aud", "The identity token audience was not accepted.");
  }
  if (exp * 1000 <= checks.nowMs) {
    throw new SiwcError("id_token_exp", "The identity token has expired.");
  }
  if (checks.nonce !== null) {
    if (nonce === null || !nonceMatches(nonce, checks.nonce)) {
      throw new SiwcNonceRejectedError();
    }
  }
  return { iss, aud: checks.audience, sub, exp, email, nonce };
}

function nonceMatches(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return mismatch === 0;
}

function readKeys(body: unknown): RsaJwk[] {
  if (typeof body !== "object" || body === null || !("keys" in body) || !Array.isArray(body.keys)) {
    throw new SiwcError("jwks_unavailable", "ChatGPT signing keys could not be loaded.");
  }
  const keys: RsaJwk[] = [];
  for (const entry of body.keys) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    if (record["kty"] !== "RSA" || typeof record["n"] !== "string" || typeof record["e"] !== "string") continue;
    const jwk: RsaJwk = {
      kty: "RSA",
      n: record["n"],
      e: record["e"],
      ...(typeof record["kid"] === "string" ? { kid: record["kid"] } : {}),
      ...(typeof record["alg"] === "string" ? { alg: record["alg"] } : {}),
      ...(typeof record["use"] === "string" ? { use: record["use"] } : {}),
    };
    keys.push(jwk);
  }
  if (keys.length === 0) {
    throw new SiwcError("jwks_unavailable", "ChatGPT signing keys could not be loaded.");
  }
  return keys;
}

function parseJson(encoded: string): unknown {
  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as unknown;
  } catch (error) {
    if (error instanceof SiwcError) throw error;
    throw new SiwcError("id_token", "The identity token was rejected.");
  }
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}
