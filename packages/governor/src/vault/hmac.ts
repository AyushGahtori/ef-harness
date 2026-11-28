import { createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { lockDownOwnerOnly } from "./ntfs-acl.js";

export class VaultHmac {
  constructor(private readonly salt: Buffer) {}

  fingerprint(value: string): string {
    return createHmac("sha256", this.salt).update(value, "utf8").digest("hex");
  }

  static async load(file: string): Promise<VaultHmac> {
    mkdirSync(path.dirname(file), { recursive: true });
    if (!existsSync(file)) {
      const created = randomBytes(32);
      writeFileSync(file, created, { mode: 0o600 });
      await lockDownOwnerOnly(file);
    }
    const salt = readFileSync(file);
    if (salt.length < 32) {
      throw new Error("Vault HMAC salt is unusable.");
    }
    return new VaultHmac(salt.subarray(0, 32));
  }
}
