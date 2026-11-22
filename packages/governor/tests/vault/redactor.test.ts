import { describe, expect, it } from "vitest";
import { LocalPacketSecurityRedactor, redactionPlaceholder } from "../../src/vault/redactor.js";

describe("PacketSecurityRedactor port", () => {
  it("redacts the raw value, encodings, and each long line", () => {
    const secret = [
      "-----BEGIN TEST KEY-----",
      "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=",
      "-----END TEST KEY-----",
    ].join("\n");
    const redactor = new LocalPacketSecurityRedactor();
    redactor.register("PEM_KEY", secret);
    const placeholder = redactionPlaceholder("PEM_KEY");
    expect(placeholder).toBe("[REDACTED_SECRET:PEM_KEY]");
    expect(redactor.redact(secret).includes(secret)).toBe(false);
    expect(redactor.redact(secret).includes(placeholder)).toBe(true);
    const line = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=";
    expect(redactor.redact(`body ${line}`).includes(line)).toBe(false);
    const encoded = Buffer.from(secret, "utf8").toString("base64");
    expect(redactor.redact(encoded).includes(encoded)).toBe(false);
    const url = encodeURIComponent(secret);
    expect(redactor.redact(url).includes(url)).toBe(false);
    expect(redactor.forget("PEM_KEY")).toBe(true);
    expect(redactor.redact(line).includes(line)).toBe(true);
  });

  it("ignores values shorter than 8 characters", () => {
    const redactor = new LocalPacketSecurityRedactor();
    redactor.register("FLAG", "short");
    expect(redactor.redact("short circuit")).toBe("short circuit");
  });
});
