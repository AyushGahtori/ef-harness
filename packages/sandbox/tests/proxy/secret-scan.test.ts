import { describe, expect, it } from "vitest";
import { CanaryVaultSecretRedactor } from "../../src/proxy/index.js";

function joinParts(parts: readonly string[]): string {
  return parts.join("");
}

describe("proxy canary and vault scanner", () => {
  it("redacts builtin secret prefixes and registered vault values", () => {
    const redactor = new CanaryVaultSecretRedactor();
    const live = joinParts(["sk", "_live_", "abcdefghijklmnopqrst"]);
    const canary = "ef-canary-vault-value-123456";
    redactor.register("canary", canary);
    redactor.register("short", "short");
    const text = `query=${live}&note=${canary}&plain=ok`;
    const redacted = redactor.redact(text);
    expect(redacted).not.toContain(live);
    expect(redacted).not.toContain(canary);
    expect(redacted).toContain("[REDACTED:SK_LIVE]");
    expect(redacted).toContain("[REDACTED:CANARY]");
    expect(redacted).toContain("plain=ok");
    expect(redactor.scanForSecrets("token=short")).toEqual([]);
  });
});
