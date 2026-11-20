import { createHmac, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { defaultHarnessHome } from "./paths.js";
import { errorCode } from "./util.js";

export class MachineKeyError extends Error {
  readonly code: string;

  constructor(message: string, code = "MACHINE_KEY_UNAVAILABLE") {
    super(message);
    this.name = "MachineKeyError";
    this.code = code;
  }
}

export interface SecretHmacOptions {
  key?: Uint8Array | string;
  directory?: string;
}

const keyCache = new Map<string, Buffer>();

export function clearMachineKeyCache(): void {
  keyCache.clear();
}

export function machineKeyPath(directory?: string): string {
  return path.join(directory ?? defaultHarnessHome(), "keys", "secret-hmac.key");
}

export function loadOrCreateMachineKey(directory?: string): Buffer {
  const file = machineKeyPath(directory);
  const cached = keyCache.get(file);
  if (cached) return Buffer.from(cached);

  let material: Buffer;
  if (fs.existsSync(file)) {
    material = fs.readFileSync(file);
    if (material.byteLength < 32) {
      throw new MachineKeyError("machine HMAC key is missing or too short", "MACHINE_KEY_INVALID");
    }
  } else {
    material = randomBytes(32);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      fs.writeFileSync(file, material, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      material = fs.readFileSync(file);
      if (material.byteLength < 32) {
        throw new MachineKeyError("machine HMAC key is missing or too short", "MACHINE_KEY_INVALID");
      }
    }
  }
  keyCache.set(file, Buffer.from(material));
  return Buffer.from(material);
}

export function computeSecretHmac(secret: string, options?: SecretHmacOptions): string {
  if (typeof secret !== "string") throw new TypeError("secret must be a string");
  const material =
    options?.key === undefined ? loadOrCreateMachineKey(options?.directory) : normalizeHmacKey(options.key);
  return createHmac("sha256", material).update(secret, "utf8").digest("hex");
}

function normalizeHmacKey(key: Uint8Array | string): Buffer {
  const material = typeof key === "string" ? Buffer.from(key, "utf8") : Buffer.from(key);
  if (material.byteLength === 0) throw new MachineKeyError("HMAC key must not be empty", "HMAC_KEY_EMPTY");
  return material;
}
