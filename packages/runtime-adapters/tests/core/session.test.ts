import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AdapterRegistry,
  EgressBreachMonitor,
  LocalCliMinVersionGate,
  LocalPacketSecurityRedactor,
  LocalSandboxTierSelector,
  LocalSessionProcessCap,
  LocalSignedProviderPolicy,
  PidTrackingJobSupervisor,
  SupervisedAgentRuntime,
  WrappedVsStrippedModeSelector,
  assertAgentRuntimeAdapter,
  scrubChildEnvironment,
  type ForeignSpawnRequest,
  type SessionStartSpec,
  type WindowsJobSupervisorPort,
} from "../../src/core/index.js";

class RecordingJob implements WindowsJobSupervisorPort {
  readonly killed: string[] = [];
  private readonly jobs = new Map<string, Set<number>>();

  create(sessionId: string): { readonly jobId: string } {
    const jobId = `job-${sessionId}`;
    this.jobs.set(jobId, new Set());
    return { jobId };
  }

  attach(jobId: string, pid: number): void {
    this.jobs.get(jobId)?.add(pid);
  }

  list(jobId: string): readonly number[] {
    return [...(this.jobs.get(jobId) ?? [])];
  }

  kill(jobId: string, reason: string): readonly number[] {
    this.killed.push(reason);
    const pids = [...(this.jobs.get(jobId) ?? [])];
    this.jobs.set(jobId, new Set());
    return pids;
  }
}

function spec(root: string, extra: Partial<SessionStartSpec> = {}): SessionStartSpec {
  return {
    sessionId: "session-1",
    worktreeRoot: root,
    writeScope: ["src/**"],
    brief: "implement orders",
    ...extra,
  };
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EPERM") return true;
    return false;
  }
}

describe("supervised runtime", () => {
  it("scrubs host secrets, wraps the sandbox, and redacts child output", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ef-runtime-"));
    const jobs = new RecordingJob();
    const spawns: ForeignSpawnRequest[] = [];
    let stdout: ((chunk: string) => void) | null = null;
    const secret = "session-credential-value";
    const redactor = new LocalPacketSecurityRedactor();
    const adapter = new SupervisedAgentRuntime({
      runtime: "codex",
      version: () => "1.2.3",
      jobs,
      redactor,
      hostEnv: {
        PATH: "C:\\Windows",
        SYSTEMROOT: "C:\\Windows",
        OPENAI_API_KEY: "host-openai-secret",
        ANTHROPIC_API_KEY: "host-anthropic-secret",
        GITHUB_TOKEN: "host-github-secret",
        AWS_SECRET_ACCESS_KEY: "host-aws-secret",
        STRIPE_SECRET_KEY: "host-stripe-secret",
        UNRELATED: "host-unrelated",
      },
      spawn(request) {
        spawns.push(request);
        return {
          pid: 4242,
          onStdout(listener) {
            stdout = listener;
          },
          onStderr() {
            return;
          },
          onExit() {
            return;
          },
          release() {
            return;
          },
        };
      },
    });
    assertAgentRuntimeAdapter(adapter);
    const handle = await adapter.startSession(
      spec(root, { credentialEnv: { SESSION_TOKEN: secret } }),
    );
    expect(handle.sandboxTier).toBe("A");
    expect(handle.jobId).toBe("job-session-1");
    expect(handle.proxyEndpoint).toContain("127.0.0.1");
    expect(handle.mcpTools).toEqual(["kb.*", "harness.run", "harness.read_result"]);
    expect(handle.nativeWeb).toBe(false);
    expect(handle.environment.OPENAI_API_KEY).toBeUndefined();
    expect(handle.environment.ANTHROPIC_API_KEY).toBeUndefined();
    expect(handle.environment.GITHUB_TOKEN).toBeUndefined();
    expect(handle.environment.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(handle.environment.STRIPE_SECRET_KEY).toBeUndefined();
    expect(handle.environment.UNRELATED).toBeUndefined();
    expect(handle.environment.PATH).toBe("C:\\Windows");
    expect(handle.environment.HTTP_PROXY).toBeTruthy();
    expect(handle.environment.SESSION_TOKEN).toBe(secret);
    expect(spawns[0]?.env.OPENAI_API_KEY).toBeUndefined();
    stdout?.(`leaked ${secret}\n`);
    expect(adapter.turnLog.text(handle.sessionId, "stdout")).toContain("[REDACTED:SESSION_TOKEN]");
    expect(adapter.turnLog.text(handle.sessionId, "stdout")).not.toContain(secret);
    adapter.ingest("session-1", {
      source: "copilot",
      event: { type: "text_delta", text: `again ${secret}` },
    });
    const streamed = adapter.bus.history("session-1").find((event) => event.type === "assistant_delta");
    expect(JSON.stringify(streamed)).not.toContain(secret);
  });

  it("blocks observe_only and disabled adapters and downgrades after an ignored deny", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ef-registry-"));
    const registry = new AdapterRegistry();
    const adapter = new SupervisedAgentRuntime({
      runtime: "codex",
      version: () => "1.2.3",
      registry,
      jobs: new RecordingJob(),
      spawn: () => ({ pid: 7, onStdout() {}, onStderr() {}, onExit() {}, release() {} }),
    });
    registry.register(adapter, "observe_only", "conformance failed");
    await expect(adapter.startSession(spec(root))).rejects.toThrow(/observe_only/);
    registry.setTrust("codex", "disabled", "operator disabled");
    await expect(adapter.startSession(spec(root))).rejects.toThrow(/disabled/);
    registry.setTrust("codex", "conformance_verified", "suite passed");
    await adapter.startSession(spec(root));
    const monitor = new EgressBreachMonitor(registry);
    monitor.blockedAfterDeny({ runtime: "codex", target: "https://evil.example" });
    expect(registry.trustOf("codex")).toBe("observe_only");
    expect(() => registry.assignCodingTask("codex")).toThrow(/observe_only/);
  });

  it("refuses launch when the binary is too old, non-compliant, or the sandbox tier is held", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ef-probe-"));
    const old = new SupervisedAgentRuntime({
      runtime: "codex",
      version: () => "0.1.0",
      versions: new LocalCliMinVersionGate({ codex: "1.2.3" }),
      jobs: new RecordingJob(),
      spawn: () => {
        throw new Error("spawned");
      },
    });
    const probe = await old.probe();
    expect(probe.status).toBe("version_too_old");
    expect(probe.minVersion).toBe("1.2.3");
    await expect(old.startSession(spec(root))).rejects.toThrow(/version_too_old/);

    const blocked = new SupervisedAgentRuntime({
      runtime: "codex",
      version: () => "2.0.0",
      signedPolicy: new LocalSignedProviderPolicy(new Map([["codex", "policy lock"]])),
      jobs: new RecordingJob(),
      spawn: () => {
        throw new Error("spawned");
      },
    });
    expect((await blocked.probe()).status).toBe("non_compliant");
    await expect(blocked.startSession(spec(root))).rejects.toThrow(/non_compliant/);

    let spawned = false;
    const held = new SupervisedAgentRuntime({
      runtime: "codex",
      version: () => "2.0.0",
      tiers: new LocalSandboxTierSelector("A", true),
      jobs: new RecordingJob(),
      spawn: () => {
        spawned = true;
        return { pid: 1, onStdout() {}, onStderr() {}, onExit() {}, release() {} };
      },
    });
    await expect(held.startSession(spec(root))).rejects.toThrow(/sandbox/);
    expect(spawned).toBe(false);

    const auth = await new SupervisedAgentRuntime({
      runtime: "gemini-cli",
      version: () => "1.0.0",
      auth: () => ({ signedIn: true, expiresAt: null, quota: null, source: "injected" }),
    }).authStatus();
    expect(auth).toEqual({ signedIn: true, expiresAt: null, quota: null, source: "injected" });
  });

  it("queues steering, resumes or signals unsupported_resume, and forces policy on permission replies", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ef-turn-"));
    const adapter = new SupervisedAgentRuntime({
      runtime: "acp",
      version: () => "1.0.0",
      jobs: new RecordingJob(),
      spawn: () => ({ pid: 11, onStdout() {}, onStderr() {}, onExit() {}, release() {} }),
    });
    await adapter.startSession(spec(root, { resumeSupported: false, writeScope: ["src/api/orders.ts"] }));
    await adapter.steer("session-1", "keep the parser strict");
    const turn = await adapter.sendTurn("session-1", "ship the brief");
    expect(turn.deliveredPrompt).toContain("ship the brief");
    expect(turn.deliveredPrompt).toContain("keep the parser strict");
    const iterator = adapter.events("session-1")[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(first.value?.type).toBe("turn_started");

    const resume = await adapter.resume("session-1", "native-session");
    expect(resume).toMatchObject({ supported: false, reason: "unsupported_resume" });

    const allowed = adapter.requestPermission("session-1", "allow-1", {
      kind: "edit",
      path: "src/api/orders.ts",
    });
    expect(allowed.effect).toBe("allow");
    expect(adapter.respondPermission("session-1", "allow-1", { effect: "allow" }).effect).toBe("allow");

    const denied = adapter.requestPermission("session-1", "deny-1", { kind: "edit", path: "nope.ts" });
    expect(denied.effect).toBe("deny");
    expect(adapter.respondPermission("session-1", "deny-1", { effect: "allow" }).effect).toBe("deny");

    adapter.ingest("session-1", {
      source: "claude",
      event: {
        type: "result",
        total_cost_usd: 2,
        usage: { input_tokens: 4, output_tokens: 6 },
      },
    });
    expect(adapter.usage("session-1")).toMatchObject({ inputTokens: 4, outputTokens: 6, costMicroUsd: 2_000_000 });
  });

  it("denies pending permissions and kills the job when the user stops", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ef-stop-"));
    const jobs = new RecordingJob();
    const adapter = new SupervisedAgentRuntime({
      runtime: "opencode",
      version: () => "1.0.0",
      jobs,
      spawn: () => ({ pid: 99, onStdout() {}, onStderr() {}, onExit() {}, release() {} }),
    });
    await adapter.startSession(spec(root));
    adapter.requestPermission("session-1", "pending-1", { kind: "shell", command: "pnpm add axios" });
    const stopped = await adapter.interrupt("session-1");
    expect(stopped.elapsedMs).toBeLessThan(500);
    expect(stopped.denied).toEqual([{ requestId: "pending-1", reason: "user_stopped" }]);
    expect(stopped.killedPids).toEqual([99]);
    expect(jobs.killed).toContain("stopped");
    const decided = adapter.bus.history("session-1").find((event) => event.type === "permission_decided");
    expect(decided?.type === "permission_decided" && decided.reason).toBe("user_stopped");
  });

  it("emits abnormal session_exited and reaps the job for exit 137 and 0xC0000005", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ef-crash-"));
    const jobs = new RecordingJob();
    let exit: ((code: number | null) => void) | null = null;
    const adapter = new SupervisedAgentRuntime({
      runtime: "codex",
      version: () => "1.0.0",
      jobs,
      spawn: () => ({
        pid: 50,
        onStdout() {
          return;
        },
        onStderr() {
          return;
        },
        onExit(listener) {
          exit = listener;
        },
        release() {
          return;
        },
      }),
    });
    await adapter.startSession(spec(root, { sessionId: "crash" }));
    exit?.(137);
    const crashed = adapter.bus.history("crash").find((event) => event.type === "session_exited");
    expect(crashed?.type === "session_exited" && crashed.disposition).toBe("abnormal");
    expect(crashed?.type === "session_exited" && crashed.handoff).toBe("Task 150");
    expect(jobs.killed).toContain("abnormal");

    const jobs2 = new RecordingJob();
    let exit2: ((code: number | null) => void) | null = null;
    const second = new SupervisedAgentRuntime({
      runtime: "codex",
      version: () => "1.0.0",
      jobs: jobs2,
      spawn: () => ({
        pid: 51,
        onStdout() {
          return;
        },
        onStderr() {
          return;
        },
        onExit(listener) {
          exit2 = listener;
        },
        release() {
          return;
        },
      }),
    });
    await second.startSession(spec(root, { sessionId: "av" }));
    exit2?.(0xc0000005);
    const violation = second.bus.history("av").find((event) => event.type === "session_exited");
    expect(violation?.type === "session_exited" && violation.disposition).toBe("abnormal");
  });

  it("interrupts a real child and its grandchild in under 500 ms", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ef-kill-"));
    const pidFile = path.join(root, "child-pid.txt");
    const script = [
      "const fs = require('node:fs');",
      "const { spawn } = require('node:child_process');",
      "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000000)'], { stdio: 'ignore', windowsHide: true });",
      "fs.writeFileSync(process.env.EF_CHILD_PID_FILE, String(child.pid));",
      "setInterval(() => {}, 1000000);",
    ].join("");
    const adapter = new SupervisedAgentRuntime({
      runtime: "opencode",
      version: () => "1.0.0",
      jobs: new PidTrackingJobSupervisor(),
      command: process.execPath,
      args: ["-e", script],
    });
    const handle = await adapter.startSession(
      spec(root, { sessionId: "live", credentialEnv: { EF_CHILD_PID_FILE: pidFile } }),
    );
    const started = Date.now();
    let grandchild = 0;
    while (!grandchild && Date.now() - started < 4000) {
      if (fs.existsSync(pidFile)) {
        grandchild = Number(fs.readFileSync(pidFile, "utf8"));
      } else {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    expect(grandchild).toBeGreaterThan(0);
    adapter.requestPermission("live", "stop-1", { kind: "shell", command: "curl https://evil.com" });
    const stopped = await adapter.interrupt("live");
    expect(stopped.elapsedMs).toBeLessThan(500);
    expect(stopped.denied[0]?.reason).toBe("user_stopped");
    expect(stopped.killedPids).toContain(handle.pid);
    expect(alive(handle.pid)).toBe(false);
    expect(alive(grandchild)).toBe(false);
  });

  it("rejects a second foreign session when the process cap is full", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ef-cap-"));
    const adapter = new SupervisedAgentRuntime({
      runtime: "cursor",
      version: () => "1.0.0",
      caps: new LocalSessionProcessCap(1),
      jobs: new RecordingJob(),
      spawn: () => ({ pid: 3, onStdout() {}, onStderr() {}, onExit() {}, release() {} }),
    });
    await adapter.startSession(spec(root, { sessionId: "one" }));
    await expect(adapter.startSession(spec(root, { sessionId: "two" }))).rejects.toThrow(/cap/);
  });
});

describe("mode selector and env scrub", () => {
  const selector = new WrappedVsStrippedModeSelector();

  it("defaults to wrapped and falls back to stripped", () => {
    const wrapped = selector.select({ nativeHooksConformant: true, tier: "A", tierHeld: false });
    expect(wrapped.mode).toBe("wrapped");
    expect(wrapped.nativeFileTools).toBe(true);
    expect(wrapped.nativeShell).toBe(true);
    expect(wrapped.nativeWeb).toBe(false);
    expect(wrapped.sandboxRequired).toBe(true);
    expect(wrapped.proxyRequired).toBe(true);
    expect(wrapped.permissionHook).toBe("DeterministicSupervisionPolicyEngine");

    expect(
      selector.select({ nativeHooksConformant: false, tier: "A", tierHeld: false }).mode,
    ).toBe("stripped");
    expect(
      selector.select({ tighterIsolation: true, nativeHooksConformant: true, tier: "B", tierHeld: false }).mode,
    ).toBe("stripped");
    expect(selector.select({ nativeHooksConformant: true, tier: "C", tierHeld: false }).mode).toBe("stripped");
    const stripped = selector.select({
      requestedMode: "stripped",
      nativeHooksConformant: true,
      tier: "A",
      tierHeld: false,
    });
    expect(stripped.nativeShell).toBe(false);
    expect(stripped.nativeFileTools).toBe(false);
    expect(stripped.mcpTools).toEqual(["kb.*", "harness.run", "harness.read_result"]);
  });

  it("strips unrelated host secrets and keeps authorized values", () => {
    const scrubbed = scrubChildEnvironment(
      {
        PATH: "C:\\Windows",
        OPENAI_API_KEY: "host-openai-secret",
        AWS_SESSION_TOKEN: "host-aws-session",
        STRIPE_SECRET_KEY: "host-stripe-secret",
      },
      { OPENAI_API_KEY: "session-openai-value", HTTP_PROXY: "http://127.0.0.1:9" },
    );
    expect(scrubbed.PATH).toBe("C:\\Windows");
    expect(scrubbed.OPENAI_API_KEY).toBe("session-openai-value");
    expect(scrubbed.HTTP_PROXY).toBe("http://127.0.0.1:9");
    expect(scrubbed.AWS_SESSION_TOKEN).toBeUndefined();
    expect(scrubbed.STRIPE_SECRET_KEY).toBeUndefined();
  });
});
