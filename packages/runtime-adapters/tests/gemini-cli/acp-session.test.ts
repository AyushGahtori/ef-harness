import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  GeminiOptInRequiredError,
  GeminiRouteRevokedError,
  GeminiVersionGateError,
  LocalSupervisionPolicyEngine,
} from "../../src/gemini-cli/index.js";
import { acceptDefaultNotice, makeHarness, makeWorktree, removeWorktree } from "./support.js";

describe("gemini --acp wrapped and stripped sessions", () => {
  it("runs wrapped mode through the ACP lifecycle and denies secret reads and git push", async () => {
    const harness = makeHarness();
    const worktree = makeWorktree();
    acceptDefaultNotice(harness.gate);
    try {
      const ssh = await harness.runtime.startSession({
        worktree,
        writeScope: ["src/**"],
        mode: "wrapped",
        attemptId: "ssh",
        extraEnv: {
          GEMINI_FAKE_PERMISSION: "ssh",
          GEMINI_FAKE_PATH: "C:\\Users\\someone\\.ssh\\id_rsa",
        },
        skills: [{ name: "review.md", body: "Check the diff." }],
      });
      expect(ssh.mode).toBe("wrapped");
      expect(ssh.sandboxed).toBe(true);
      expect(ssh.jobAttached).toBe(true);
      expect(ssh.pooled).toBe(true);
      expect(ssh.loopbackProxy.startsWith("http://127.0.0.1:")).toBe(true);
      expect(ssh.mcpServers).toEqual(["harness"]);
      expect(harness.sandbox.attachments[0]?.mode).toBe("wrapped");
      const exclude = fs.readFileSync(path.join(worktree, ".git", "info", "exclude"), "utf8");
      expect(exclude).toContain(".ef-gemini-skills/");
      expect(fs.existsSync(path.join(worktree, ".ef-gemini-skills", "review.md"))).toBe(true);
      expect(fs.existsSync(path.join(ssh.geminiCliHome, "settings.json"))).toBe(false);

      const turn = await harness.runtime.sendTurn(ssh.sessionId, "read a key");
      expect(turn.permissionOutcome).toBe("reject_once");
      expect(turn.usage.inputTokens).toBe(11);
      expect(turn.usage.outputTokens).toBe(7);
      expect(turn.usage.cachedInputTokens).toBe(3);
      expect(turn.usage.reasoningTokens).toBe(2);
      expect((await harness.runtime.usage(ssh.sessionId)).cacheWriteTokens).toBe(1);
      const decision = await harness.runtime.respondPermission(ssh.sessionId, "9001", {
        outcome: "allow_once",
      });
      expect(decision.outcome).toBe("reject_once");
      expect(decision.reason).toBe("secret_path_denied");
      const streamed: string[] = [];
      for await (const event of harness.runtime.events(ssh.sessionId)) {
        streamed.push(event.type);
        if (event.type === "turn_completed") break;
      }
      expect(streamed).toContain("usage_reported");
      expect(harness.runtime.eventsFor(ssh.sessionId).some((event) => event.type === "usage_reported")).toBe(
        true,
      );
      expect(
        harness.runtime.eventsFor(ssh.sessionId).some((event) => event.type === "permission_decided"),
      ).toBe(true);

      await harness.runtime.close();
      expect(fs.existsSync(path.join(worktree, ".ef-gemini-skills", "review.md"))).toBe(false);

      const pushHarness = makeHarness();
      acceptDefaultNotice(pushHarness.gate);
      const push = await pushHarness.runtime.startSession({
        worktree,
        writeScope: ["src/**"],
        mode: "wrapped",
        attemptId: "push",
        extraEnv: { GEMINI_FAKE_PERMISSION: "push" },
      });
      const pushed = await pushHarness.runtime.sendTurn(push.sessionId, "publish");
      expect(pushed.permissionOutcome).toBe("reject_once");
      expect(pushHarness.harnessRun.calls).toHaveLength(0);
      const resumed = await pushHarness.runtime.resume(push.sessionId, push.sessionId);
      expect(resumed.supported).toBe(true);
      await pushHarness.runtime.interrupt(push.sessionId);
      expect(pushHarness.runtime.activePool()).toHaveLength(0);
      await pushHarness.runtime.close();
    } finally {
      await removeWorktree(worktree);
    }
  });

  it("stripped mode denies built-in shell and records harness.run", async () => {
    const harness = makeHarness();
    const worktree = makeWorktree();
    acceptDefaultNotice(harness.gate);
    try {
      const started = await harness.runtime.startSession({
        worktree,
        writeScope: ["src/**"],
        mode: "stripped",
        extraEnv: { GEMINI_FAKE_PERMISSION: "shell", GEMINI_FAKE_COMMAND: "npm test" },
      });
      const settings = JSON.parse(
        fs.readFileSync(path.join(started.geminiCliHome, "settings.json"), "utf8"),
      ) as { tools: { exclude: string[] } };
      expect(settings.tools.exclude).toEqual([
        "shell",
        "web_fetch",
        "web_search",
        "google_web_search",
      ]);
      const turn = await harness.runtime.sendTurn(started.sessionId, "run tests");
      expect(turn.permissionOutcome).toBe("reject_once");
      expect(harness.harnessRun.calls).toEqual([{ command: "npm test", cwd: worktree }]);
      expect(harness.sandbox.attachments[0]?.mode).toBe("stripped");

      const allowed = makeHarness();
      acceptDefaultNotice(allowed.gate);
      const write = await allowed.runtime.startSession({
        worktree,
        writeScope: ["src/**"],
        mode: "wrapped",
        attemptId: "write",
        extraEnv: { GEMINI_FAKE_PERMISSION: "write", GEMINI_FAKE_PATH: "src/app.ts" },
      });
      const wrote = await allowed.runtime.sendTurn(write.sessionId, "edit");
      expect(wrote.permissionOutcome).toBe("allow_once");
      await allowed.runtime.close();
    } finally {
      await harness.runtime.close();
      await removeWorktree(worktree);
    }
  });

  it("classifies daily quota separately from a transient 429 and refuses silent paid fallback", async () => {
    const quota = makeHarness();
    const rpm = makeHarness();
    const worktree = makeWorktree();
    acceptDefaultNotice(quota.gate);
    acceptDefaultNotice(rpm.gate);
    try {
      const exhausted = await quota.runtime.startSession({
        worktree,
        writeScope: ["src/**"],
        attemptId: "quota",
        extraEnv: { GEMINI_FAKE_LIMIT: "exhausted" },
      });
      const stopped = await quota.runtime.sendTurn(exhausted.sessionId, "continue");
      expect(stopped.limit.kind).toBe("quota_exhaustion");
      expect(stopped.limit.cwnd).toBe(0);
      expect(stopped.limit.retryAllowed).toBe(false);
      expect(stopped.parked).toBe(true);
      expect(stopped.silentFallback).toEqual({ accepted: false, reason: "no_silent_paid_fallback" });
      expect(quota.runtime.checkpointStopCard).toMatchObject({
        kind: "checkpoint_stop",
        reason: "usage_limit_exhausted",
        usageLimitReason: "daily_quota",
        silentPaidFallback: false,
        retryAllowed: false,
      });
      expect(quota.runtime.cwnd).toBe(0);
      expect(quota.runtime.activePool()).toHaveLength(0);

      const limited = await rpm.runtime.startSession({
        worktree,
        writeScope: ["src/**"],
        attemptId: "rpm",
        extraEnv: { GEMINI_FAKE_LIMIT: "rpm" },
      });
      const backedOff = await rpm.runtime.sendTurn(limited.sessionId, "retry");
      expect(backedOff.limit.kind).toBe("transient_rpm");
      expect(backedOff.limit.cwnd).toBe(1);
      expect(backedOff.limit.retryAllowed).toBe(true);
      expect(backedOff.limit.stopCard).toBeNull();
      expect(backedOff.parked).toBe(false);
      expect(backedOff.silentFallback.accepted).toBe(false);
      expect(rpm.runtime.activePool()).toEqual([limited.sessionId]);
    } finally {
      await quota.runtime.close();
      await rpm.runtime.close();
      await removeWorktree(worktree);
    }
  });

  it("parks on settings disable and on signed route revocation", async () => {
    const harness = makeHarness();
    const worktree = makeWorktree();
    acceptDefaultNotice(harness.gate);
    try {
      const started = await harness.runtime.startSession({
        worktree,
        writeScope: ["src/**"],
        attemptId: "live",
      });
      await harness.runtime.disable();
      expect(harness.runtime.enabled).toBe(false);
      expect(harness.runtime.activePool()).toHaveLength(0);
      expect(harness.gate.optedIn).toBe(true);
      await expect(
        harness.runtime.startSession({ worktree, writeScope: ["src/**"], attemptId: "again" }),
      ).rejects.toBeInstanceOf(GeminiOptInRequiredError);

      acceptDefaultNotice(harness.gate);
      const revived = await harness.runtime.startSession({
        worktree,
        writeScope: ["src/**"],
        attemptId: "revoked",
      });
      expect(harness.runtime.activePool()).toEqual([revived.sessionId]);
      await harness.runtime.applySignedPolicy({
        kind: "route_revoked",
        routeId: "gemini_cli_acp",
        notice: "Signed policy revoked gemini_cli_acp.",
      });
      expect(harness.runtime.signedPolicyNotice).toBe("Signed policy revoked gemini_cli_acp.");
      expect(harness.runtime.activePool()).toHaveLength(0);
      expect(harness.runtime.enabled).toBe(false);
      await expect(
        harness.runtime.startSession({ worktree, writeScope: ["src/**"], attemptId: "after" }),
      ).rejects.toBeInstanceOf(GeminiRouteRevokedError);
      expect(started.sessionId).toBe("gemini-session-1");
    } finally {
      await harness.runtime.close();
      await removeWorktree(worktree);
    }
  });

  it("blocks sessions below the minimum version or without --acp", async () => {
    const old = makeHarness({ probeEnv: { GEMINI_FAKE_VERSION: "0.1.0" } });
    const noAcp = makeHarness({ probeEnv: { GEMINI_FAKE_HELP: "no-acp" } });
    const worktree = makeWorktree();
    acceptDefaultNotice(old.gate);
    acceptDefaultNotice(noAcp.gate);
    try {
      await expect(
        old.runtime.startSession({ worktree, writeScope: ["src/**"], attemptId: "old" }),
      ).rejects.toBeInstanceOf(GeminiVersionGateError);
      expect(old.runtime.launches.some((launch) => launch.args.includes("--acp"))).toBe(false);
      await expect(
        noAcp.runtime.startSession({ worktree, writeScope: ["src/**"], attemptId: "help" }),
      ).rejects.toBeInstanceOf(GeminiVersionGateError);
      const probed = await noAcp.runtime.probe();
      expect(probed.reason).toBe("missing_acp_flag");
      expect(probed.allowed).toBe(false);
    } finally {
      await old.runtime.close();
      await noAcp.runtime.close();
      await removeWorktree(worktree);
    }
  });

  it("decides supervision synchronously", () => {
    const harness = makeHarness();
    const policy = new LocalSupervisionPolicyEngine(harness.harnessRun);
    const context = {
      mode: "wrapped" as const,
      worktree: "C:\\work\\repo",
      writeScope: ["src/**"],
    };
    policy.decide(
      { requestId: "warm", kind: "execute", title: "shell", command: "git push", filePath: null },
      context,
    );
    const started = process.hrtime.bigint();
    const decision = policy.decide(
      { requestId: "1", kind: "execute", title: "shell", command: "git push origin main", filePath: null },
      context,
    );
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    expect(decision.outcome).toBe("reject_once");
    expect(elapsedMs).toBeLessThan(15);
  });
});
