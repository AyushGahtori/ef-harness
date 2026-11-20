import { describe, expect, it } from "vitest";
import { evaluateProfileAccess, hostMatches } from "../../src/proxy/index.js";

describe("proxy hostname matching", () => {
  it("matches exact hosts and explicit suffixes only", () => {
    expect(hostMatches("api.openai.com", "api.openai.com")).toBe(true);
    expect(hostMatches("API.OPENAI.COM", "api.openai.com")).toBe(true);
    expect(hostMatches("api.openai.com.", "api.openai.com")).toBe(true);
    expect(hostMatches("api.openai.com.evil.com", "api.openai.com")).toBe(false);
    expect(hostMatches("evil-api.openai.com", "api.openai.com")).toBe(false);
    expect(hostMatches("api.openai.com.evil.com", ".openai.com")).toBe(false);
    expect(hostMatches("docs.example.com", ".example.com")).toBe(true);
    expect(hostMatches("example.com", ".example.com")).toBe(true);
    expect(hostMatches("notexample.com", ".example.com")).toBe(false);
    expect(hostMatches("example.com.evil.com", ".example.com")).toBe(false);
    expect(hostMatches("evil.com", ".example.com")).toBe(false);
  });

  it("starts every profile from default deny", () => {
    const denied = evaluateProfileAccess({
      profile: "verifier_test",
      hostname: "api.stripe.com",
      port: 443,
      method: "GET",
      connect: false,
      allowedTestEndpoints: [],
      documentationHosts: [],
      corporateRegistries: [],
    });
    expect(denied).toMatchObject({ allow: false, status: 403 });
    const worker = evaluateProfileAccess({
      profile: "coding_worker",
      hostname: "registry.npmjs.org",
      port: 443,
      method: "GET",
      connect: true,
      allowedTestEndpoints: [{ host: "registry.npmjs.org", port: 443 }],
      documentationHosts: ["registry.npmjs.org"],
      corporateRegistries: [],
    });
    expect(worker).toMatchObject({ allow: false, status: 403, reason: "coding_worker_deny_all" });
  });
});
