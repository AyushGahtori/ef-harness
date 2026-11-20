import { describe, expect, it } from "vitest";
import {
  CanonicalizationError,
  computeFailureFingerprint,
  normalizePosixPath,
  stripVolatileFailureTokens,
} from "../../src/canonical/index.js";

describe("computeFailureFingerprint", () => {
  const stable = {
    failureClass: "assertion",
    ruleId: "AC-31",
    filePath: "src/kitchen/print.ts",
    detail: "Expected 10 at line 45 in print.ts:45:12 [2026-11-19T13:05:00.123Z] localhost:54321",
  };

  it("ignores line, timestamp, and port changes and POSIX-normalizes the path", () => {
    const againDetail =
      "Expected 10 at line 99 in print.ts:10:2 [2020-01-01 00:00:00Z] localhost:1234 port 65535";
    expect(stripVolatileFailureTokens(stable.detail ?? "")).toBe(
      stripVolatileFailureTokens(againDetail),
    );
    const again = computeFailureFingerprint(
      "assertion",
      "AC-31",
      "src\\kitchen\\print.ts",
      againDetail,
    );
    expect(computeFailureFingerprint(stable)).toBe(again);
    expect(
      computeFailureFingerprint({ ...stable, filePath: "C:\\src\\kitchen\\print.ts" }),
    ).toBe(computeFailureFingerprint({ ...stable, filePath: "/src/kitchen/print.ts" }));
    expect(computeFailureFingerprint(stable)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("changes when the failure class, rule, or remaining detail changes", () => {
    const base = computeFailureFingerprint(stable);
    expect(computeFailureFingerprint({ ...stable, failureClass: "timeout" })).not.toBe(base);
    expect(computeFailureFingerprint({ ...stable, ruleId: "AC-32" })).not.toBe(base);
    expect(
      computeFailureFingerprint({ ...stable, detail: "Expected 11 at line 45 localhost:1" }),
    ).not.toBe(base);
  });

  it("treats NFD and NFC copies of the same failure as one fingerprint", () => {
    expect(
      computeFailureFingerprint({
        failureClass: "Cafe\u0301",
        ruleId: "AC-31",
        filePath: "src/a.ts",
        detail: "e\u0301",
      }),
    ).toBe(
      computeFailureFingerprint({
        failureClass: "Caf\u00e9",
        ruleId: "AC-31",
        filePath: "src/a.ts",
        detail: "\u00e9",
      }),
    );
  });

  it("normalizes paths and strips only volatile tokens", () => {
    expect(normalizePosixPath("C:\\src\\kitchen\\print.ts")).toBe("/src/kitchen/print.ts");
    expect(normalizePosixPath("src\\kitchen\\print.ts")).toBe("src/kitchen/print.ts");
    expect(normalizePosixPath("/src//kitchen/./print.ts")).toBe("/src/kitchen/print.ts");
    expect(stripVolatileFailureTokens("Expected close at 10:45")).toBe("Expected close at 10:45");
    expect(stripVolatileFailureTokens("boom\n  at print.ts:45:12")).toBe("boom at print.ts");
  });

  it("rejects missing strings", () => {
    expect(() => computeFailureFingerprint("assertion", "AC-31")).toThrow(CanonicalizationError);
  });
});
