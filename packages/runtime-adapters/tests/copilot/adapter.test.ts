import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CopilotAuthExpiredError } from "../../src/copilot/index.js";
import {
  TOKEN,
  createHarness,
  disposeHarness,
  sessionSpec,
  type Harness,
} from "./fakes.js";

const open: Harness[] = [];

afterEach(() => {
  while (open.length > 0) {
    const harness = open.pop();
    if (harness) disposeHarness(harness);
  }
});

function harness(): Harness {
  const created = createHarness("sdk");
  open.push(created);
  return created;
}

describe("Copilot SDK adapter lifecycle", () => {
  it("implements all 10 AgentRuntimeAdapter methods in wrapped mode", async () => {
    const env = harness();
    const probed = await env.adapter.probe();
    expect(probed.installed).toBe(true);
    expect(probed.versionStatus).toBe("ok");
    expect(probed.transport).toBe("sdk");
    expect(probed.modes).toEqual(["wrapped", "stripped"]);
    expect(probed.enabledModelIds).toEqual(["gpt-4.1"]);
    expect(probed.excludedModelIds).toEqual(["claude-sonnet"]);

    const auth = await env.adapter.authStatus("copilot-1");
    expect(auth.signedIn).toBe(true);
    expect(auth.cardTitle).toBeNull();
    expect(auth.excludedModelIds).toContain("claude-sonnet");
    expect(auth.quota?.remaining).toBe(10);

    const ref = await env.adapter.startSession(sessionSpec(env.worktree));
    expect(ref.posture).toBe("wrapped");
    expect(ref.transport).toBe("sdk");
    expect(env.sdk.lastConfig?.excludedTools).toEqual([]);
    expect(env.sdk.lastConfig?.gitHubToken).toBe(TOKEN);
    expect(env.sdk.lastConfig?.mcpServers[0]?.tools).toEqual(
      expect.arrayContaining(["kb.*", "harness.run", "harness.read_result"]),
    );

    const receipt = await env.adapter.sendTurn(ref.sessionId, "edit src/app.ts");
    expect(receipt.dispatched).toBe(true);
    expect(receipt.usage.inputTokens).toBe(10);
    expect(receipt.usage.outputTokens).toBe(4);
    expect(receipt.usage.billingMode).toBe("copilot_subscription");
    expect(receipt.usage.subscriptionQuotaApplies).toBe(true);

    const steered = await env.adapter.steer(ref.sessionId, "keep the public types");
    expect(steered.applied).toBe("mid_turn");

    const usage = await env.adapter.usage(ref.sessionId);
    expect(usage.cachedInputTokens).toBe(1);
    expect(usage.cacheCreationInputTokens).toBe(2);

    const config = env.sdk.lastConfig;
    if (!config) throw new Error("SDK session config was not captured");
    const decision = await config.onPermissionRequest({
      requestId: "edit-1",
      kind: "write",
      path: path.join(env.worktree, "src", "app.ts"),
    });
    expect(decision.kind).toBe("approved");
    const applied = await env.adapter.respondPermission(ref.sessionId, "edit-1", { effect: "allow" });
    expect(applied.effect).toBe("allow");
    expect(applied.elapsedMs).toBeLessThan(2);

    const resumed = await env.adapter.resume(ref.sessionId, { attemptId: "attempt-1" });
    expect(resumed.supported).toBe(true);
    expect(resumed.fallback).toBe("native");
    expect(resumed.reason).toBe("native");

    const iterator = env.adapter.events(ref.sessionId)[Symbol.asyncIterator]();
    const started = await iterator.next();
    expect(started.done).toBe(false);
    if (!started.done) expect(started.value.type).toBe("session_started");

    const stopped = await env.adapter.interrupt(ref.sessionId);
    expect(stopped.interrupted).toBe(true);
    expect(stopped.lingeringProcesses).toBe(0);
    expect(stopped.elapsedMs).toBeLessThan(500);
  });

  it("keeps Copilot config inside the worktree exclude list and out of the user profile", async () => {
    const env = harness();
    const personal = path.join(os.homedir(), ".copilot");
    const personalConfig = path.join(os.homedir(), ".config", "github-copilot");
    const beforePersonal = fs.existsSync(personal) ? fs.statSync(personal).mtimeMs : null;
    const beforeConfig = fs.existsSync(personalConfig) ? fs.statSync(personalConfig).mtimeMs : null;
    await env.adapter.startSession(sessionSpec(env.worktree));
    const configFile = path.join(env.worktree, ".ef-copilot", "session.json");
    const skill = path.join(env.worktree, ".ef-copilot", "skills", "review.md");
    const exclude = path.join(env.worktree, ".git", "info", "exclude");
    expect(fs.readFileSync(configFile, "utf8")).not.toContain(TOKEN);
    expect(fs.existsSync(skill)).toBe(true);
    expect(fs.readFileSync(exclude, "utf8")).toContain(".ef-copilot/");
    const afterPersonal = fs.existsSync(personal) ? fs.statSync(personal).mtimeMs : null;
    const afterConfig = fs.existsSync(personalConfig) ? fs.statSync(personalConfig).mtimeMs : null;
    expect(afterPersonal).toBe(beforePersonal);
    expect(afterConfig).toBe(beforeConfig);
  });

  it("reports an old Copilot CLI as version_too_old and refuses to start", async () => {
    const env = harness();
    env.sdk.version = "0.9.0";
    const probed = await env.adapter.probe();
    expect(probed.versionStatus).toBe("version_too_old");
    expect(probed.requiredVersion).toBe("1.0.0");
    await expect(env.adapter.startSession(sessionSpec(env.worktree))).rejects.toThrow(/version_too_old/);
    expect(env.sdk.sendCount).toBe(0);
  });

  it("parks on 401 with one account card and does not read another paid connection", async () => {
    const env = harness();
    env.sdk.failAuthOnSend = true;
    const ref = await env.adapter.startSession(sessionSpec(env.worktree));
    await expect(env.adapter.sendTurn(ref.sessionId, "continue")).rejects.toBeInstanceOf(CopilotAuthExpiredError);
    await expect(env.adapter.sendTurn(ref.sessionId, "continue again")).rejects.toBeInstanceOf(
      CopilotAuthExpiredError,
    );
    expect(env.cards.accounts).toHaveLength(1);
    expect(env.cards.accounts[0]?.title).toBe("Re-authenticate GitHub Copilot");
    expect(env.tokens.reads.every((id) => id === "copilot-1")).toBe(true);
    expect(env.fallback.refusals.length).toBeGreaterThan(0);
    expect(env.sdk.sendCount).toBe(0);
  });

  it("resumes natively, and falls back on contradiction or unsupported resume", async () => {
    const env = harness();
    const ref = await env.adapter.startSession(sessionSpec(env.worktree, { contradiction: true }));
    const contradicted = await env.adapter.resume(ref.sessionId, {
      attemptId: "attempt-1",
      contradiction: true,
    });
    expect(contradicted.fallback).toBe("fresh_session");
    expect(contradicted.reason).toBe("contradiction");
    expect(contradicted.sessionId).toBeNull();
    expect(env.sdk.resumeCount).toBe(0);

    const fresh = harness();
    fresh.sdk.resumeSupported = false;
    const unsupportedRef = await fresh.adapter.startSession(sessionSpec(fresh.worktree, { attemptId: "attempt-2" }));
    const unsupported = await fresh.adapter.resume(unsupportedRef.sessionId, { attemptId: "attempt-2" });
    expect(unsupported.reason).toBe("unsupported_resume");
    expect(fresh.sdk.resumeCount).toBe(0);

    const missing = await fresh.adapter.resume(unsupportedRef.sessionId, { attemptId: "missing" });
    expect(missing.reason).toBe("missing_checkpoint");
  });

  it("defaults missing getMetrics fields to 0 and tags an interrupted turn", async () => {
    const env = harness();
    env.sdk.metrics = { inputTokens: 5 };
    env.sdk.partial = true;
    const ref = await env.adapter.startSession(sessionSpec(env.worktree));
    const receipt = await env.adapter.sendTurn(ref.sessionId, "partial");
    expect(receipt.usage.inputTokens).toBe(5);
    expect(receipt.usage.outputTokens).toBe(0);
    expect(receipt.usage.cachedInputTokens).toBe(0);
    expect(receipt.usage.reasoningTokens).toBe(0);
    expect(receipt.usage.premiumRequests).toBe(0);
    expect(receipt.usage.partial_interrupted).toBe(true);

    env.sdk.metricsThrows = true;
    const usage = await env.adapter.usage(ref.sessionId);
    expect(usage.inputTokens).toBe(0);
    expect(usage.partial_interrupted).toBe(true);
  });

  it("terminates a hung vitest watch child with the job object", async () => {
    const env = harness();
    env.sdk.spawnWatchChild = true;
    const ref = await env.adapter.startSession(sessionSpec(env.worktree));
    const pid = env.sdk.child?.pid;
    expect(pid).toBeTruthy();
    expect(env.jobs.list(`job-${ref.sessionId}`)).toEqual([pid]);
    const stopped = await env.adapter.interrupt(ref.sessionId);
    expect(stopped.lingeringProcesses).toBe(0);
    expect(stopped.elapsedMs).toBeLessThan(500);
    expect(env.jobs.list(`job-${ref.sessionId}`)).toEqual([]);
    await expect.poll(() => alive(pid ?? 0), { timeout: 2000 }).toBe(false);
    expect(fs.existsSync(path.join(env.worktree, ".ef-copilot"))).toBe(false);
  });

  it("still finishes interrupt when the SDK interrupt call hangs", async () => {
    const env = harness();
    env.sdk.hungInterrupt = true;
    const ref = await env.adapter.startSession(sessionSpec(env.worktree));
    const stopped = await env.adapter.interrupt(ref.sessionId);
    expect(stopped.lingeringProcesses).toBe(0);
    expect(stopped.elapsedMs).toBeLessThan(500);
  });
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
