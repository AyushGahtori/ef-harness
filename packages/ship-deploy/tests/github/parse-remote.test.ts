import { describe, expect, it } from "vitest";
import { containsEmbeddedToken, parseGitHubRemote } from "../../src/github/parse-remote.js";

describe("parseGitHubRemote", () => {
  it("parses https remotes", () => {
    const parsed = parseGitHubRemote("https://github.com/octocat/hello-world.git");
    expect(parsed).toEqual({
      owner: "octocat",
      repo: "hello-world",
      host: "github.com",
      raw: "https://github.com/octocat/hello-world.git",
      transport: "https",
    });
  });

  it("parses ssh remotes", () => {
    const parsed = parseGitHubRemote("git@github.com:octocat/hello-world.git");
    expect(parsed?.transport).toBe("ssh");
    expect(parsed?.owner).toBe("octocat");
  });

  it("parses GitHub Enterprise hosts", () => {
    const parsed = parseGitHubRemote("https://github.example.corp/acme/widgets.git");
    expect(parsed?.host).toBe("github.example.corp");
  });

  it("detects embedded token urls", () => {
    const tokenUrl = `https://${["ghp", "_secret"].join("")}@github.com/o/r.git`;
    expect(containsEmbeddedToken(tokenUrl)).toBe(true);
    expect(containsEmbeddedToken("https://github.com/o/r.git")).toBe(false);
  });
});