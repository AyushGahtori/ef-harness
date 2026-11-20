import {
  createHash,
  createPublicKey,
  createSign,
  createVerify,
  generateKeyPairSync,
  type KeyObject,
} from "node:crypto";

export interface RsaPublicJwk {
  readonly kty: "RSA";
  readonly use: "sig";
  readonly alg: "RS256";
  readonly kid: string;
  readonly n: string;
  readonly e: string;
}

export interface RsaSigningKey {
  readonly kid: string;
  readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;
  readonly jwk: RsaPublicJwk;
}

export interface JwtParts {
  readonly header: Readonly<Record<string, unknown>>;
  readonly payload: Readonly<Record<string, unknown>>;
}

export function generateRsaSigningKey(): RsaSigningKey {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const exported: unknown = publicKey.export({ format: "jwk" });
  if (!isRsaMaterial(exported)) {
    throw new Error("RSA public key did not export modulus and exponent");
  }
  const kid = createHash("sha256").update(exported.n).digest("base64url").slice(0, 16);
  return {
    kid,
    privateKey,
    publicKey,
    jwk: {
      kty: "RSA",
      use: "sig",
      alg: "RS256",
      kid,
      n: exported.n,
      e: exported.e,
    },
  };
}

export function importRsaPublicJwk(jwk: RsaPublicJwk): KeyObject {
  return createPublicKey({
    key: {
      kty: jwk.kty,
      n: jwk.n,
      e: jwk.e,
      alg: jwk.alg,
      use: jwk.use,
      kid: jwk.kid,
    },
    format: "jwk",
  });
}

export function signRs256Jwt(
  payload: Readonly<Record<string, unknown>>,
  key: Pick<RsaSigningKey, "kid" | "privateKey">,
): string {
  const header = base64urlJson({ alg: "RS256", typ: "JWT", kid: key.kid });
  const body = base64urlJson(payload);
  const signingInput = `${header}.${body}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(key.privateKey);
  return `${signingInput}.${Buffer.from(signature).toString("base64url")}`;
}

export function decodeJwt(token: string): JwtParts {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("JWT must have three segments");
  }
  return {
    header: parseJsonSegment(parts[0], "header"),
    payload: parseJsonSegment(parts[1], "payload"),
  };
}

export function verifyRs256Jwt(token: string, publicKey: KeyObject): JwtParts {
  const parts = token.split(".");
  const headerSegment = parts[0];
  const payloadSegment = parts[1];
  const signatureSegment = parts[2];
  if (parts.length !== 3 || !headerSegment || !payloadSegment || !signatureSegment) {
    throw new Error("JWT must have three segments");
  }
  const header = parseJsonSegment(headerSegment, "header");
  if (header.alg !== "RS256") {
    throw new Error(`JWT alg ${String(header.alg)} is rejected`);
  }
  const signingInput = `${headerSegment}.${payloadSegment}`;
  let signature: Buffer;
  try {
    signature = Buffer.from(signatureSegment, "base64url");
  } catch (error) {
    throw new Error(`JWT signature encoding is invalid: ${errorMessage(error)}`);
  }
  const ok = createVerify("RSA-SHA256").update(signingInput).verify(publicKey, signature);
  if (!ok) {
    throw new Error("JWT signature verification failed");
  }
  return { header, payload: parseJsonSegment(payloadSegment, "payload") };
}

function base64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function parseJsonSegment(segment: string | undefined, label: string): Record<string, unknown> {
  if (!segment) throw new Error(`JWT ${label} is missing`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as unknown;
  } catch (error) {
    throw new Error(`JWT ${label} is not JSON: ${errorMessage(error)}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`JWT ${label} must be an object`);
  }
  return parsed as Record<string, unknown>;
}

function isRsaMaterial(value: unknown): value is { n: string; e: string } {
  if (typeof value !== "object" || value === null) return false;
  const record = value as { n?: unknown; e?: unknown };
  return typeof record.n === "string" && record.n.length > 0 && typeof record.e === "string" && record.e.length > 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
