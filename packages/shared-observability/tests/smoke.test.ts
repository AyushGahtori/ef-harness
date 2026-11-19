import { describe, expect, it } from "vitest";
import { formatLog, layer, packageName, redactSecrets } from "../src/index.js";

describe("@ef-harness/shared-observability", () => {
  it("publishes a stable package identity", () => {
    expect(packageName).toBe("@ef-harness/shared-observability");
    expect(layer).toBe(0);
  });

  it("redacts assembled secret markers", () => {
    const sample = ["sk", "_live_", "test123"].join("");
    expect(redactSecrets(sample)).toBe("[redacted]test123");
    const line = formatLog("info", sample);
    expect(line.includes(sample)).toBe(false);
    expect(line.includes("[redacted]")).toBe(true);
  });
});
