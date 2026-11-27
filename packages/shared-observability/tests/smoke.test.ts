import { describe, expect, it } from "vitest";
import {
  LocalTracer,
  PacketSecurityRedactor,
  SECRET_LABEL,
  SecretRedactor,
  StreamingRedactor,
  StructuredLogger,
  formatLog,
  getSharedSecretRedactor,
  layer,
  packageName,
  redactSecrets,
  scanForSecrets,
} from "../src/index.js";

describe("@ef-harness/shared-observability", () => {
  it("publishes a stable package identity", () => {
    expect(packageName).toBe("@ef-harness/shared-observability");
    expect(layer).toBe(0);
  });

  it("delegates redactSecrets and formatLog to the shared SecretRedactor", () => {
    const sample = ["sk", "_live_", "1234567890abcdef"].join("");
    expect(redactSecrets(sample)).toBe(`[REDACTED:${SECRET_LABEL.stripeLive}]`);
    const line = formatLog("info", sample, { token: sample, ok: true });
    expect(line.includes(sample)).toBe(false);
    expect(line.includes("1234567890abcdef")).toBe(false);
    expect(line.includes(`[REDACTED:${SECRET_LABEL.stripeLive}]`)).toBe(true);
  });

  it("re-exports canonical telemetry primitives and redacts split chunks across every byte offset", () => {
    const redactor = new SecretRedactor();
    expect(new PacketSecurityRedactor()).toBeInstanceOf(SecretRedactor);
    expect(getSharedSecretRedactor()).toBeInstanceOf(SecretRedactor);
    expect(typeof StructuredLogger).toBe("function");
    expect(typeof LocalTracer).toBe("function");

    const token = ["sk", "_live_", "1234567890abcdef"].join("");
    expect(scanForSecrets(token).length).toBeGreaterThan(0);

    const payload = Buffer.from(`lead ${token} trail`, "utf8");
    for (let offset = 1; offset < payload.length; offset += 1) {
      const stream = new StreamingRedactor(redactor, 16);
      const output =
        stream.push(payload.subarray(0, offset)) +
        stream.push(payload.subarray(offset)) +
        stream.flush();
      expect(output).toBe(`lead [REDACTED:${SECRET_LABEL.stripeLive}] trail`);
      expect(output).not.toContain("1234567890abcdef");
    }

    const utf8Secret = "caféSecretValue123";
    redactor.register("UTF8_KEY", utf8Secret);
    const utf8Bytes = Buffer.from(`a ${utf8Secret} b`, "utf8");
    const splitAt = utf8Bytes.indexOf(0xc3) + 1;
    const utf8Stream = redactor.openStream({ overlap: 8 });
    const utf8Output =
      utf8Stream.push(utf8Bytes.subarray(0, splitAt)) +
      utf8Stream.push(utf8Bytes.subarray(splitAt)) +
      utf8Stream.flush();
    expect(utf8Output).toBe("a [REDACTED:UTF8_KEY] b");
  });
});
