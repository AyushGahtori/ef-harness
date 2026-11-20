import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearMachineKeyCache,
  computeSecretHmac,
  machineKeyPath,
} from "../../src/telemetry/hmac.js";
import { tempDir } from "./helpers.js";

const secret = "VaultSecretValue99";
const directories: string[] = [];

afterEach(() => {
  clearMachineKeyCache();
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("computeSecretHmac", () => {
  it("returns a stable non-reversible sha256 fingerprint", () => {
    const key = Buffer.from("machine-key-machine-key-machine!!");
    const first = computeSecretHmac(secret, { key });
    const second = computeSecretHmac(secret, { key });
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toContain(secret);
    expect(computeSecretHmac("other-secret-value", { key })).not.toBe(first);
    expect(computeSecretHmac(secret, { key: Buffer.from("different-key-different-key!!!!") })).not.toBe(
      first,
    );
  });

  it("creates and reuses a local per-machine key without storing the secret", () => {
    const directory = tempDir("hmac");
    directories.push(directory);
    const first = computeSecretHmac(secret, { directory });
    const second = computeSecretHmac(secret, { directory });
    const file = machineKeyPath(directory);
    const stored = fs.readFileSync(file);
    expect(second).toBe(first);
    expect(stored.byteLength).toBeGreaterThanOrEqual(32);
    expect(stored.toString("utf8")).not.toContain(secret);
    expect(first).not.toContain(secret);
    clearMachineKeyCache();
    expect(computeSecretHmac(secret, { directory })).toBe(first);
  });
});
