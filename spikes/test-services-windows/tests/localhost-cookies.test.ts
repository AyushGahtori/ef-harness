import { describe, expect, it } from "vitest";
import { probeLocalhostCookieIsolation } from "../src/localhost-cookies.ts";

describe("*.localhost isolation", () => {
  it("resolves env hosts to loopback and does not share cookies", async () => {
    const report = await probeLocalhostCookieIsolation();
    expect(report.env1ResolvedToLoopback).toBe(true);
    expect(report.env2ResolvedToLoopback).toBe(true);
    expect(report.env1CookieVisibleOnEnv1).toBe(true);
    expect(report.env1CookieVisibleOnEnv2).toBe(false);
    expect(report.isolated).toBe(true);
  }, 180_000);
});
