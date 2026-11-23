import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OpenCodeConfigGenerator, evaluatePermission, type ProviderConnection } from "../../src/opencode/index.js";

const generator = new OpenCodeConfigGenerator();

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "oc149-cfg-"));
}

function connection(overrides: Partial<ProviderConnection> = {}): ProviderConnection {
  return {
    connectionId: "conn-openai",
    provider: "openai",
    model: "gpt-test",
    baseUrl: "http://127.0.0.1:18080/v1",
    apiKey: "provider-key-openai",
    paid: true,
    ...overrides,
  };
}

function input(root: string, overrides: Record<string, unknown> = {}) {
  const worktree = path.join(root, "wt");
  const configDir = path.join(root, "cfg");
  fs.mkdirSync(worktree, { recursive: true });
  fs.mkdirSync(configDir, { recursive: true });
  return {
    configDir,
    worktreePath: worktree,
    mode: "wrapped",
    connection: connection(),
    mcp: { url: "http://127.0.0.1:19777/mcp", bearerToken: "attempt-bearer-149" },
    ...overrides,
  };
}

describe("OpenCodeConfigGenerator", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it("emits ordered denials, disables auto compaction, and attaches only the leased MCP server", () => {
    const root = tempRoot();
    roots.push(root);
    const generated = generator.generate(input(root));
    const document = generated.document;
    expect(document.compaction.auto).toBe(false);
    expect(document.permission.bash).toBe("deny");
    expect(document.permission.shell).toBe("deny");
    expect(document.permission.webfetch).toBe("deny");
    expect(document.permission.websearch).toBe("deny");
    expect(document.permission.external_directory).toBe("deny");
    expect(document.permission.doom_loop).toBe("deny");
    expect(document.permission.edit).toBe("ask");
    expect(document.permission.write).toBe("ask");
    expect(document.tools.bash).toBe(false);
    expect(document.tools.webfetch).toBe(false);
    expect(document.tools.websearch).toBe(false);
    expect(Object.keys(document.mcp)).toEqual(["ef-harness"]);
    expect(document.mcp["ef-harness"].headers.Authorization).toBe("Bearer attempt-bearer-149");
    expect(document.mcp["ef-harness"].url).toBe("http://127.0.0.1:19777/mcp");
    expect(generated.env.OPENCODE_CONFIG).toBeUndefined();
    expect(fs.readFileSync(generated.configPath, "utf8")).toContain('"auto": false');
    for (const [action, resource] of [
      ["bash", "rm -rf /"],
      ["bash", "git push"],
      ["shell", "git push"],
      ["webfetch", "https://evil.com"],
      ["websearch", "sqlite"],
      ["external_directory", "C:/outside"],
      ["doom_loop", "same-call"],
    ] as const) {
      expect(evaluatePermission(document.permission, action, resource)).toBe("deny");
    }
  });

  it("keeps last-match glob order and treats a string rule as unconditional", () => {
    expect(
      evaluatePermission(
        { bash: { "*": "allow", "git push*": "deny", "rm -rf /*": "deny" } },
        "bash",
        "git push origin",
      ),
    ).toBe("deny");
    expect(evaluatePermission({ bash: { "*": "allow", "git push*": "deny" } }, "bash", "git status")).toBe("allow");
    expect(evaluatePermission({ bash: "deny" }, "bash", "git status --short")).toBe("deny");
  });

  it("overrides a hostile repo and personal config without writing either file", () => {
    const root = tempRoot();
    roots.push(root);
    const worktree = path.join(root, "wt");
    const userFile = path.join(root, "user-opencode.json");
    const repoFile = path.join(worktree, "opencode.json");
    const userText = `${JSON.stringify({ permission: "allow", mcp: { personal: { type: "remote", url: "http://127.0.0.1:1/p" } } }, null, 2)}\n`;
    const repoText = `${JSON.stringify({
      permission: { bash: "allow", webfetch: "allow", edit: "allow" },
      mcp: { rogue: { type: "remote", url: "http://127.0.0.1:2/rogue", enabled: true } },
    })}\n`;
    fs.mkdirSync(worktree, { recursive: true });
    fs.writeFileSync(userFile, userText);
    fs.writeFileSync(repoFile, repoText);
    const generated = generator.generate({
      ...input(root),
      userConfig: JSON.parse(userText),
      repoConfig: JSON.parse(repoText),
      preservePaths: [userFile, repoFile],
    });
    expect(fs.readFileSync(userFile, "utf8")).toBe(userText);
    expect(fs.readFileSync(repoFile, "utf8")).toBe(repoText);
    expect(generated.document.permission.bash).toBe("deny");
    expect(generated.document.permission.webfetch).toBe("deny");
    expect(Object.keys(generated.document.mcp)).toEqual(["ef-harness"]);
    expect(JSON.stringify(generated.document)).not.toContain("rogue");
    expect(JSON.stringify(generated.document)).not.toContain("personal");
    expect(JSON.stringify(generated.document)).not.toContain("provider-key-openai");
  });

  it("denies native edit tools in stripped mode and routes ollama through loopback", () => {
    const root = tempRoot();
    roots.push(root);
    const stripped = generator.generate({
      ...input(root, {
        mode: "stripped",
        connection: connection({
          provider: "ollama",
          model: "llama",
          baseUrl: "http://127.0.0.1:11434",
          paid: false,
          apiKey: undefined,
        }),
      }),
    });
    expect(stripped.document.permission.edit).toBe("deny");
    expect(stripped.document.permission.write).toBe("deny");
    expect(stripped.document.tools.edit).toBe(false);
    expect(stripped.document.provider.ollama?.options.baseURL).toBe("http://127.0.0.1:11434");
  });

  it("rejects a provider base URL that leaves the loopback proxy", () => {
    const root = tempRoot();
    roots.push(root);
    expect(() =>
      generator.generate(
        input(root, {
          connection: connection({ baseUrl: "https://api.example.test/v1" }),
        }),
      ),
    ).toThrow(/loopback/i);
  });
});
