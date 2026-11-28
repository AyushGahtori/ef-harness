import { describe, expect, it } from "vitest";
import { argvContainsToken, EphemeralGitCredentialHelper } from "../../src/github/credential-helper.js";

describe("EphemeralGitCredentialHelper", () => {
  it("forbids embedded token remotes", () => {
    const helper = new EphemeralGitCredentialHelper({ token: "gho_safe" });
    const badRemote = `https://${["ghp", "_leak"].join("")}@github.com/o/r.git`;
    expect(() => helper.assertSafeRemote(badRemote)).toThrow(/Embedded token/);
  });

  it("does not place tokens in argv", () => {
    const argv = ["git", "push", "origin", "harness/f1"];
    expect(argvContainsToken(argv)).toBe(false);
  });
});