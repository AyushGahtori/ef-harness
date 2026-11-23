import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  randomBytes,
  type KeyObject,
} from "node:crypto";
import { LOCAL_PORT_CIPHER } from "./types.ts";

type Jwk = Record<string, string>;

interface SealedBlob {
  readonly cipher: typeof LOCAL_PORT_CIPHER;
  readonly epk: Jwk;
  readonly iv: string;
  readonly tag: string;
  readonly data: string;
}

export interface SealedKey {
  readonly publicJwk: Jwk;
  readonly privateJwk: Jwk;
}

export function generateSealedKey(): SealedKey {
  const pair = generateKeyPairSync("x25519");
  return {
    publicJwk: toJwk(pair.publicKey.export({ format: "jwk" })),
    privateJwk: toJwk(pair.privateKey.export({ format: "jwk" })),
  };
}

function importPublic(jwk: Jwk): KeyObject {
  return createPublicKey({ key: jwk, format: "jwk" });
}

function importPrivate(jwk: Jwk): KeyObject {
  return createPrivateKey({ key: jwk, format: "jwk" });
}

function toJwk(value: ReturnType<KeyObject["export"]>): Jwk {
  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  return Object.fromEntries(entries);
}

export function sealText(recipientPublicJwk: Jwk, plaintext: string): string {
  const ephemeral = generateKeyPairSync("x25519");
  const shared = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: importPublic(recipientPublicJwk) });
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", shared.subarray(0, 32), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const blob: SealedBlob = {
    cipher: LOCAL_PORT_CIPHER,
    epk: toJwk(ephemeral.publicKey.export({ format: "jwk" })),
    iv: iv.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
    data: data.toString("hex"),
  };
  return `${JSON.stringify(blob)}\n`;
}

export function openSealedText(recipientPrivateJwk: Jwk, serialized: string): string {
  const blob = JSON.parse(serialized) as SealedBlob;
  if (blob.cipher !== LOCAL_PORT_CIPHER) {
    throw new Error("unexpected sealed cipher");
  }
  const shared = diffieHellman({
    privateKey: importPrivate(recipientPrivateJwk),
    publicKey: importPublic(blob.epk),
  });
  const decipher = createDecipheriv("aes-256-gcm", shared.subarray(0, 32), Buffer.from(blob.iv, "hex"));
  decipher.setAuthTag(Buffer.from(blob.tag, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(blob.data, "hex")), decipher.final()]).toString("utf8");
}
