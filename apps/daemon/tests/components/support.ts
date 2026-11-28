import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  sha256Hex,
  signComponentManifest,
  type ComponentManifest,
} from "../../src/components/index.js";

export interface TestKeys {
  readonly publicKey: Buffer;
  readonly privateKey: KeyObject;
  readonly keyId: string;
}

export function makeKeys(): TestKeys {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" });
  if (typeof jwk.x !== "string") throw new Error("missing raw public key");
  return {
    publicKey: Buffer.from(jwk.x, "base64url"),
    privateKey,
    keyId: "test-components",
  };
}

export function signedManifest(manifest: ComponentManifest, privateKey: KeyObject): string {
  return JSON.stringify({
    manifest,
    signature: signComponentManifest(manifest, privateKey),
  });
}

export function fileManifest(input: {
  keyId: string;
  id: string;
  label: string;
  bytes: Buffer;
  fileName: string;
  primaryUrl: string;
  mirrorUrls?: readonly string[];
  version?: string;
}): ComponentManifest {
  const sha256 = sha256Hex(input.bytes);
  return {
    keyId: input.keyId,
    components: [
      {
        id: input.id,
        label: input.label,
        version: input.version ?? "1.0.0",
        sizeBytes: input.bytes.length,
        sha256,
        primaryUrl: input.primaryUrl,
        mirrorUrls: input.mirrorUrls ?? [],
        packaging: "file",
        files: [{ path: input.fileName, sha256, sizeBytes: input.bytes.length }],
      },
    ],
  };
}

export interface Loopback {
  readonly origin: string;
  close(): Promise<void>;
}

export async function listenLoopback(
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>,
): Promise<Loopback> {
  const server = createServer((req, res) => {
    req.on("error", () => undefined);
    res.on("error", () => undefined);
    void Promise.resolve(handler(req, res)).catch(() => {
      if (!res.writableEnded) res.destroy();
    });
  });
  server.on("clientError", () => undefined);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("loopback port missing");
  return {
    origin: `http://127.0.0.1:${String(address.port)}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

export function tempComponentsRoot(): string {
  return mkdtempSync(path.join(tmpdir(), "ef132-"));
}

export function removeTemp(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

export const generousHeadroom = {
  freeBytes(): bigint {
    return 9_000_000_000_000n;
  },
};
