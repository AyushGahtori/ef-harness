import { describe, expect, it } from "vitest";
import { PacketSecurityRedactor, StreamingRedactor, redactionPlaceholder } from "../../src/vault/redactor.js";

describe("PacketSecurityRedactor port", () => {
  it("redacts the raw value, encodings, and each long line", () => {
    const secret = [
      "-----BEGIN TEST KEY-----",
      "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=",
      "-----END TEST KEY-----",
    ].join("\n");
    const redactor = new PacketSecurityRedactor();
    redactor.register("PEM_KEY", secret);
    const placeholder = redactionPlaceholder("PEM_KEY");
    expect(placeholder).toBe("[REDACTED:PEM_KEY]");
    const stream = new StreamingRedactor(redactor, 32);
    expect(`${stream.push(secret)}${stream.flush()}`.includes(secret)).toBe(false);
    expect(redactor.redact(secret).includes(secret)).toBe(false);
    expect(redactor.redact(secret).includes(placeholder)).toBe(true);
    const encoded = Buffer.from(secret, "utf8").toString("base64");
    expect(redactor.redact(encoded).includes(encoded)).toBe(false);
    const url = encodeURIComponent(secret);
    expect(redactor.redact(url).includes(url)).toBe(false);
    const token = "CANARY_FORGET_TOKEN_999";
    redactor.register("CANARY", token);
    expect(redactor.redact(token).includes(token)).toBe(false);
    expect(redactor.forget("CANARY")).toBe(true);
    expect(redactor.redact(token).includes(token)).toBe(true);
  });

  it("ignores values shorter than 8 characters", () => {
    const redactor = new PacketSecurityRedactor();
    redactor.register("FLAG", "short");
    expect(redactor.redact("short circuit")).toBe("short circuit");
  });
});
