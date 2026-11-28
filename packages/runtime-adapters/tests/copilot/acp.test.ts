import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COPILOT_ACP_ARGV } from "../../src/copilot/index.js";
import { TOKEN, createHarness, disposeHarness, sessionSpec } from "./fakes.js";

describe("Copilot ACP fallback", () => {
  it("implements all 10 methods through GenericAcpAdapter with copilot --acp --stdio", async () => {
    const env = createHarness("acp");
    try {
      const probed = await env.acpAdapter.probe();
      expect(probed.transport).toBe("acp");
      expect(probed.versionStatus).toBe("ok");
      expect(probed.enabledModelIds).toEqual(["gpt-4.1"]);
      expect(probed.excludedModelIds).toEqual(["claude-sonnet"]);

      const auth = await env.acpAdapter.authStatus("copilot-1");
      expect(auth.signedIn).toBe(true);
      expect(auth.quota?.remaining).toBe(10);

      const ref = await env.facade.startSession(sessionSpec(env.worktree, { transport: "acp" }));
      expect(ref.transport).toBe("acp");
      expect(env.acp.lastSpec?.argv).toEqual([...COPILOT_ACP_ARGV]);
      expect(env.acp.lastSpec?.argv.join(" ")).not.toContain(TOKEN);
      expect(env.acp.lastSpec?.gitHubToken).toBe(TOKEN);
      expect(env.acp.lastSpec?.excludedTools).toEqual([]);

      const receipt = await env.facade.sendTurn(ref.sessionId, "acp turn");
      expect(receipt.dispatched).toBe(true);
      expect(receipt.usage.inputTokens).toBe(3);
      const steered = await env.facade.steer(ref.sessionId, "queue this note");
      expect(steered.applied).toBe("queued");
      const usage = await env.facade.usage(ref.sessionId);
      expect(usage.outputTokens).toBe(2);

      const decision = await env.acp.permission({
        requestId: "acp-push",
        kind: "shell",
        command: "git push",
      });
      expect(decision.kind).toBe("denied");
      const allowed = await env.acp.permission({
        requestId: "acp-edit",
        kind: "write",
        path: path.join(env.worktree, "src", "app.ts"),
      });
      expect(allowed.kind).toBe("approved");
      const applied = await env.facade.respondPermission(ref.sessionId, "acp-edit", { effect: "allow" });
      expect(applied.effect).toBe("allow");

      const resumed = await env.facade.resume(ref.sessionId, { attemptId: "attempt-1" });
      expect(resumed.fallback).toBe("native");
      const iterator = env.facade.events(ref.sessionId)[Symbol.asyncIterator]();
      const first = await iterator.next();
      expect(first.done).toBe(false);
      const stopped = await env.facade.interrupt(ref.sessionId);
      expect(stopped.lingeringProcesses).toBe(0);
      expect(stopped.elapsedMs).toBeLessThan(500);
      expect(fs.existsSync(path.join(env.worktree, ".ef-copilot", "session.json"))).toBe(false);
    } finally {
      disposeHarness(env);
    }
  });

  it("selects ACP when signed policy prefers it, and stripped mode still excludes shell and web", async () => {
    const env = createHarness("acp");
    try {
      const ref = await env.facade.startSession(
        sessionSpec(env.worktree, { posture: "stripped", attemptId: "attempt-acp" }),
      );
      expect(ref.transport).toBe("acp");
      expect(ref.posture).toBe("stripped");
      expect(env.acp.lastSpec?.argv).toEqual(["copilot", "--acp", "--stdio"]);
      expect(env.acp.lastSpec?.excludedTools).toEqual(["shell", "web_fetch", "web_search"]);
    } finally {
      disposeHarness(env);
    }
  });
});
