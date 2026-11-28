import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LocalDeterministicSupervisionPolicyEngine,
  STRIPPED_EXCLUDED_TOOLS,
  onPermissionRequest,
  type PathResolver,
} from "../../src/copilot/index.js";
import { createHarness, disposeHarness, sessionSpec } from "./fakes.js";

describe("Copilot onPermissionRequest", () => {
  it("allows in-scope edits and approved test runs, and denies host, push, pr, and install", async () => {
    const env = createHarness();
    try {
      const ref = await env.adapter.startSession(sessionSpec(env.worktree));
      const config = env.sdk.lastConfig;
      if (!config) throw new Error("SDK session config was not captured");
      const cases: { request: Parameters<typeof config.onPermissionRequest>[0]; kind: "approved" | "denied" }[] = [
        {
          request: { requestId: "edit", kind: "write", path: path.join(env.worktree, "src", "app.ts") },
          kind: "approved",
        },
        {
          request: { requestId: "read", kind: "read", path: path.join(env.worktree, "src", "app.ts") },
          kind: "approved",
        },
        {
          request: { requestId: "test", kind: "shell", command: "pnpm test" },
          kind: "approved",
        },
        {
          request: { requestId: "vitest", kind: "shell", command: "vitest --watch" },
          kind: "approved",
        },
        {
          request: { requestId: "outside", kind: "write", path: path.join(env.worktree, "other", "file.ts") },
          kind: "denied",
        },
        {
          request: { requestId: "ssh", kind: "read", path: path.join(os.homedir(), ".ssh", "id_rsa") },
          kind: "denied",
        },
        {
          request: { requestId: "tilde", kind: "read", path: "~/.ssh/id_ed25519" },
          kind: "denied",
        },
        {
          request: { requestId: "push", kind: "shell", command: "git push origin main" },
          kind: "denied",
        },
        {
          request: { requestId: "pr", kind: "shell", command: "gh pr create --fill" },
          kind: "denied",
        },
        {
          request: { requestId: "add", kind: "shell", command: "pnpm add axios" },
          kind: "denied",
        },
        {
          request: { requestId: "web", kind: "web", url: "https://example.test" },
          kind: "denied",
        },
        {
          request: { requestId: "curl", kind: "shell", command: "curl https://example.test" },
          kind: "denied",
        },
        {
          request: { requestId: "iwr", kind: "shell", command: "Invoke-WebRequest https://example.test" },
          kind: "denied",
        },
        {
          request: { requestId: "mcp", kind: "mcp", tool: "harness.run" },
          kind: "approved",
        },
      ];
      for (const entry of cases) {
        await config.onPermissionRequest(entry.request);
        const decision = await config.onPermissionRequest(entry.request);
        expect(decision.kind, entry.request.requestId).toBe(entry.kind);
        const stored = env.adapter.permissionResult(entry.request.requestId ?? "");
        expect(stored?.elapsedMs, entry.request.requestId).toBeLessThan(2);
      }
      const forced = await env.adapter.respondPermission(ref.sessionId, "push", { effect: "allow" });
      expect(forced.effect).toBe("deny");
      expect(forced.reason).toMatch(/Destructive git commands are disabled/);
    } finally {
      disposeHarness(env);
    }
  });

  it("denies built-in shell and web tools in stripped mode and records excludedTools", async () => {
    const env = createHarness();
    try {
      await env.adapter.startSession(sessionSpec(env.worktree, { posture: "stripped" }));
      expect(env.sdk.lastConfig?.excludedTools).toEqual([...STRIPPED_EXCLUDED_TOOLS]);
      const config = env.sdk.lastConfig;
      if (!config) throw new Error("SDK session config was not captured");
      const shell = await config.onPermissionRequest({
        requestId: "stripped-shell",
        kind: "shell",
        command: "pnpm test",
      });
      expect(shell.kind).toBe("denied");
      expect(shell.reason).toMatch(/Stripped mode disables native file, shell, and web tools/);
      const web = await config.onPermissionRequest({
        requestId: "stripped-web",
        kind: "web",
        tool: "web_fetch",
      });
      expect(web.kind).toBe("denied");
      const edit = await config.onPermissionRequest({
        requestId: "stripped-edit",
        kind: "write",
        path: path.join(env.worktree, "src", "app.ts"),
      });
      expect(edit.kind).toBe("denied");
      const mcp = await config.onPermissionRequest({
        requestId: "stripped-mcp",
        kind: "mcp",
        tool: "kb.search",
      });
      expect(mcp.kind).toBe("approved");
    } finally {
      disposeHarness(env);
    }
  });

  it("denies a symlink whose real path leaves the worktree", () => {
    const worktree = path.resolve("C:\\worktrees\\attempt");
    const link = path.join(worktree, "src", "escape");
    const outside = path.resolve("C:\\secret\\.ssh\\id_rsa");
    const engine = new LocalDeterministicSupervisionPolicyEngine(new LinkResolver(worktree, link, outside));
    const decision = onPermissionRequest(
      engine,
      { posture: "wrapped", worktree, writeScope: ["src/**"], leasedTools: ["harness.run"] },
      { requestId: "link", kind: "read", path: link },
    );
    expect(decision.effect).toBe("deny");
    expect(decision.elapsedMs).toBeLessThan(2);
  });
});

class LinkResolver implements PathResolver {
  constructor(
    private readonly worktree: string,
    private readonly link: string,
    private readonly outside: string,
  ) {}

  exists(target: string): boolean {
    const resolved = path.resolve(target);
    return [this.worktree, this.link, this.outside].some((item) => path.resolve(item) === resolved);
  }

  realpath(target: string): string {
    if (path.resolve(target) === path.resolve(this.link)) return path.resolve(this.outside);
    return path.resolve(target);
  }
}
