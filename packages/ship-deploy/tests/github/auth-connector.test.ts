import { describe, expect, it, vi } from "vitest";
import { GitHubAuthConnector } from "../../src/github/auth-connector.js";
import { MockDeviceOAuth, InMemoryVault } from "./mock-github-api.js";

describe("GitHubAuthConnector", () => {
  it("reuses gh auth with one-click and stores in vault", async () => {
    const vault = new InMemoryVault();
    const connector = new GitHubAuthConnector({
      projectId: "p1",
      vault,
      cli: {
        authStatus: async () => ({
          authenticated: true,
          login: "octocat",
          token: "gho_cli_token",
          scopes: ["repo"],
          hostname: "github.com",
        }),
      },
    });
    const offers = await connector.probeCliReuse();
    expect(offers[0]?.label).toContain("@octocat");
    const session = await connector.acceptCliReuse("octocat");
    expect(session.secretId).toBe("github-octocat");
    expect(await vault.readGitHubToken(session.secretId)).toBe("gho_cli_token");
  });

  it("completes device oauth and stores token in vault", async () => {
    const vault = new InMemoryVault();
    const device = new MockDeviceOAuth();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ login: "devuser" }),
      })),
    );
    const connector = new GitHubAuthConnector({
      projectId: "p2",
      vault,
      cli: { authStatus: async () => ({ authenticated: false, login: null, token: null, scopes: [], hostname: null }) },
      deviceFlow: {
        clientId: "Iv1.mock",
        defaultScopes: ["repo"],
        http: device,
        sleep: async () => undefined,
      },
    });
    const session = await connector.deviceAuthorize();
    expect(session.login).toBe("devuser");
    expect(vault.putCount).toBe(1);
    vi.unstubAllGlobals();
  });

  it("detects workflow scope needs", () => {
    const connector = new GitHubAuthConnector({
      projectId: "p3",
      vault: new InMemoryVault(),
      cli: { authStatus: async () => ({ authenticated: false, login: null, token: null, scopes: [], hostname: null }) },
    });
    expect(connector.scopesCoverWorkflow(["repo"])).toBe(false);
    expect(connector.scopesCoverWorkflow(["repo", "workflow"])).toBe(true);
  });
});