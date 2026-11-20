import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildHelperPayload,
  createTierAMxcProvider,
  MxcCommandTimeoutError,
  MxcForegroundExitError,
  MxcModeError,
  MxcPoolError,
  percentileNearestRank,
  SandboxUnavailableError,
  TierAMxcProvider,
} from "../../src/tier-a-mxc/index.js";
import type { SandboxTierProvider, SpawnRequest } from "../../src/tier-a-mxc/index.js";
import { createMemoryAuditLog, createMemoryGovernor, createMemoryJobManager } from "../../src/tier-a-mxc/index.js";
import { readyAvailability, realSpec, testKernel } from "./fixture.js";

function harness() {
  return {
    jobManager: createMemoryJobManager(),
    logger: createMemoryAuditLog(),
    governor: createMemoryGovernor(),
  };
}

describe("TierAMxcProvider", () => {
  it("implements the shared tier provider and refuses a silent unsandboxed launch", async () => {
    const { root, spec } = await realSpec("closed");
    const calls: SpawnRequest[] = [];
    const parts = harness();
    const provider = new TierAMxcProvider({
      ...parts,
      spawner: {
        async spawn(request) {
          calls.push(request);
          return { exitCode: 0, stdout: "", stderr: "", pid: 1 };
        },
      },
      probe: async () => readyAvailability(),
    });
    const typed: SandboxTierProvider = provider;
    expect(typed.tier).toBe("A");
    expect(typed.capabilities.requiresAdmin).toBe(false);
    const probed = await typed.probe();
    expect(probed.launchable).toBe(false);
    const instance = await typed.acquireWarmInstance(spec);
    await expect(typed.executeCommand(instance, { command: process.execPath, args: ["-e", "1"] })).rejects.toBeInstanceOf(
      SandboxUnavailableError,
    );
    expect(calls).toHaveLength(0);
    await typed.disposeInstance(instance);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("wipes temp residue between commands and across worktrees", async () => {
    const first = await realSpec("wipe-a", { attemptId: "a" });
    const second = await realSpec("wipe-b", { attemptId: "b" });
    const parts = harness();
    let calls = 0;
    const provider = createTierAMxcProvider({
      ...parts,
      allowTestKernel: true,
      poolSize: 1,
      kernel: testKernel(async (request) => {
        calls += 1;
        const entries = await fs.readdir(request.tempDir);
        if (calls === 1) {
          await fs.writeFile(path.join(request.tempDir, "residue.txt"), "residue");
        } else {
          expect(entries.includes("residue.txt")).toBe(false);
        }
        return { launched: true, pid: 10 + calls, exitCode: 0, stdout: "", stderr: "", denied: [] };
      }),
    });
    const instance = await provider.acquireWarmInstance(first.spec);
    await provider.executeCommand(instance, { command: process.execPath, args: [] });
    expect(await fs.readFile(path.join(first.spec.tempDir, "residue.txt"), "utf8")).toBe("residue");
    await provider.executeCommand(instance, { command: process.execPath, args: [] });
    await provider.disposeInstance(instance);
    expect(await fs.readdir(first.spec.tempDir)).toEqual([]);
    const rebound = await provider.acquireWarmInstance(second.spec);
    expect(rebound.attemptId).toBe("b");
    expect(rebound.policy?.attemptId).toBe("b");
    expect(rebound.generation).toBeGreaterThan(1);
    await expect(provider.acquireWarmInstance(first.spec)).rejects.toBeInstanceOf(MxcPoolError);
    await provider.disposeInstance(rebound);
    await fs.rm(first.root, { recursive: true, force: true });
    await fs.rm(second.root, { recursive: true, force: true });
  });

  it("rejects detached commands, records denials and latency, and closes the per-command job", async () => {
    const { root, spec } = await realSpec("audit");
    const parts = harness();
    const stamps = [0, 10, 20, 40];
    let cursor = 0;
    const provider = createTierAMxcProvider({
      ...parts,
      allowTestKernel: true,
      clock: () => stamps[cursor++] ?? 0,
      kernel: testKernel(async () => ({
        launched: true,
        pid: 42,
        exitCode: 0,
        stdout: "",
        stderr: "",
        denied: [{ access: "read", target: "C:\\secret", errno: "EACCES", ruleId: "deny_read_ssh" }],
      })),
    });
    const instance = await provider.acquireWarmInstance(spec);
    await expect(provider.executeCommand(instance, { command: process.execPath, args: [], background: true })).rejects.toBeInstanceOf(
      MxcForegroundExitError,
    );
    await expect(provider.executeCommand(instance, { command: process.execPath, args: [], detach: true })).rejects.toBeInstanceOf(
      MxcForegroundExitError,
    );
    const decision = provider.checkAccess(instance, path.join(spec.userProfile, ".ssh", "canary"), "read");
    expect(decision.allowed).toBe(false);
    expect(parts.logger.entries.some((entry) => entry.fields.ruleId === "deny_read_ssh")).toBe(true);
    expect(parts.governor.denials.some((entry) => entry.source === "policy")).toBe(true);
    const result = await provider.executeCommand(instance, { command: process.execPath, args: ["-e", "0"] });
    expect(result.enforcement).toBe("test_double");
    expect(result.pid).toBe(42);
    expect(parts.governor.denials.some((entry) => entry.source === "os")).toBe(true);
    expect(parts.governor.latencies[0]).toMatchObject({ p50Ms: 10, p95Ms: 10, tier: "A" });
    expect(percentileNearestRank([10, 20, 30, 40, 100], 50)).toBe(30);
    expect(percentileNearestRank([10, 20, 30, 40, 100], 95)).toBe(100);
    const job = parts.jobManager.jobs[0];
    expect(job?.limits.killOnJobClose).toBe(true);
    expect(job?.limits.uiRestrictions).toBe(true);
    expect(job?.limits.activeProcessLimit).toBe(64);
    expect(job?.closed).toBe(true);
    expect(job?.pids).toEqual([42]);
    await provider.disposeInstance(instance);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("injects one wrapped vendor token and keeps the session job until dispose", async () => {
    const { root, spec } = await realSpec("wrapped");
    const parts = harness();
    let seenToken = "";
    let launches = 0;
    const provider = createTierAMxcProvider({
      ...parts,
      allowTestKernel: true,
      kernel: testKernel(async (request) => {
        launches += 1;
        expect(request.env.GH_TOKEN).toBeUndefined();
        expect(request.policy.mode).toBe("wrapped");
        if (launches === 1) {
          seenToken = request.env.ACCESS_TOKEN ?? "";
          expect(request.env.ANTHROPIC_API_KEY).toBeUndefined();
          expect(request.policy.network.providerHosts).toEqual(["api.openai.com", "chatgpt.com"]);
        }
        return { launched: true, pid: 7, exitCode: null, stdout: "", stderr: "", denied: [] };
      }),
    });
    const handle = await provider.spawnWrappedProcess({
      ...spec,
      mode: "wrapped",
      vendor: "codex",
      command: process.execPath,
      args: [],
      token: "scoped-value",
    });
    expect(seenToken).toBe("scoped-value");
    expect(handle.providerHosts).toEqual(["api.openai.com", "chatgpt.com"]);
    expect(handle.enforcement).toBe("test_double");
    expect(parts.jobManager.jobs[0]?.closed).toBe(false);
    await provider.disposeInstance(handle.instance);
    expect(parts.jobManager.jobs[0]?.terminatedReason).toBe("dispose");
    await expect(
      provider.spawnWrappedProcess({
        ...spec,
        mode: "wrapped",
        vendor: "gemini",
        command: process.execPath,
        args: [],
        token: "nope",
      }),
    ).rejects.toBeInstanceOf(MxcModeError);
    const gemini = await provider.spawnWrappedProcess({
      ...spec,
      mode: "wrapped",
      vendor: "gemini",
      command: process.execPath,
      args: [],
    });
    expect(gemini.instance.policy?.readOnly.some((entry) => entry.endsWith(`${path.sep}.gemini`))).toBe(true);
    await provider.disposeInstance(gemini.instance);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("terminates a hung command at the wall-clock limit", async () => {
    const { root, spec } = await realSpec("timeout");
    const parts = harness();
    const provider = createTierAMxcProvider({
      ...parts,
      allowTestKernel: true,
      kernel: testKernel(() => new Promise(() => undefined)),
    });
    const instance = await provider.acquireWarmInstance(spec);
    await expect(
      provider.executeCommand(instance, { command: process.execPath, args: [], timeoutMs: 30 }),
    ).rejects.toBeInstanceOf(MxcCommandTimeoutError);
    expect(parts.jobManager.jobs[0]?.terminatedReason).toBe("timeout");
    expect(parts.jobManager.jobs[0]?.closed).toBe(true);
    await provider.disposeInstance(instance);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("spawns only the pinned helper and never the user command directly", async () => {
    const { root, spec } = await realSpec("helper");
    const helper = path.join(root, "ef-mxc-launch.exe");
    await fs.writeFile(helper, "");
    const calls: SpawnRequest[] = [];
    const parts = harness();
    const provider = new TierAMxcProvider({
      ...parts,
      helperPath: helper,
      probe: async () => readyAvailability({ helperPresent: true, launchable: true, launchBlocker: null }),
      spawner: {
        async spawn(request) {
          calls.push(request);
          const payload = JSON.parse(request.stdin) as {
            failOpen: boolean;
            command: { file: string };
            denyReadFiles: string[];
            requireNativeDenyPaths: boolean;
          };
          expect(payload.failOpen).toBe(false);
          expect(payload.requireNativeDenyPaths).toBe(true);
          expect(payload.command.file).toBe(process.execPath);
          expect(payload.denyReadFiles.some((entry) => entry.endsWith(`${path.sep}canary`))).toBe(true);
          if (request.onPid) await request.onPid(77);
          expect(parts.jobManager.jobs.at(-1)?.pids).toEqual([77]);
          return {
            exitCode: 0,
            pid: 77,
            stderr: "",
            stdout: `${JSON.stringify({ pid: 77, exitCode: 0, stdout: "ok", stderr: "", denied: [] })}\n`,
          };
        },
      },
    });
    const ssh = path.join(spec.userProfile, ".ssh");
    await fs.mkdir(ssh, { recursive: true });
    await fs.writeFile(path.join(ssh, "canary"), "canary");
    const instance = await provider.acquireWarmInstance(spec);
    const result = await provider.executeCommand(instance, { command: process.execPath, args: ["-e", "0"] });
    expect(result.enforcement).toBe("os_mxc");
    expect(result.stdout).toBe("ok");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.file).toBe(helper);
    expect(calls[0]?.args).toEqual(["--protocol", "ef-mxc-launch/1"]);
    expect(calls[0]?.file).not.toBe(process.execPath);
    expect(parts.jobManager.jobs[0]?.pids).toEqual([77]);
    const policy = instance.policy;
    if (!policy) throw new Error("missing policy");
    const sample = buildHelperPayload({
      command: process.execPath,
      args: [],
      cwd: spec.worktree,
      env: { PATH: "C:\\Windows" },
      policy,
      tempDir: spec.tempDir,
      attemptId: spec.attemptId,
      mode: "per_command",
      stdinPayload: "",
    });
    expect(sample.callsExportDirectly).toBe(false);
    expect(sample.policy.writable.length).toBeGreaterThan(0);
    await provider.disposeInstance(instance);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("fails closed when the helper cannot enforce deny-read paths", async () => {
    const { root, spec } = await realSpec("helper-closed");
    const helper = path.join(root, "ef-mxc-launch.exe");
    await fs.writeFile(helper, "");
    const parts = harness();
    const provider = new TierAMxcProvider({
      ...parts,
      helperPath: helper,
      probe: async () => readyAvailability({ helperPresent: true, launchable: true, launchBlocker: null }),
      spawner: {
        async spawn() {
          return {
            exitCode: 1,
            pid: 9,
            stderr: "",
            stdout: `${JSON.stringify({ error: "deny_paths_unsupported", launched: false })}\n`,
          };
        },
      },
    });
    const instance = await provider.acquireWarmInstance(spec);
    await expect(provider.executeCommand(instance, { command: process.execPath, args: [] })).rejects.toBeInstanceOf(
      SandboxUnavailableError,
    );
    await provider.disposeInstance(instance);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("releases the warm instance when a wrapped launch fails closed", async () => {
    const { root, spec } = await realSpec("wrap-fail");
    const provider = createTierAMxcProvider({
      ...harness(),
      allowTestKernel: true,
      poolSize: 1,
      kernel: testKernel(async () => {
        throw new SandboxUnavailableError("deny_paths_unsupported");
      }),
    });
    await expect(
      provider.spawnWrappedProcess({
        ...spec,
        mode: "wrapped",
        vendor: "codex",
        command: process.execPath,
        args: [],
        token: "scoped-value",
      }),
    ).rejects.toBeInstanceOf(SandboxUnavailableError);
    const again = await provider.acquireWarmInstance(spec);
    expect(again.attemptId).toBe(spec.attemptId);
    await provider.disposeInstance(again);
    await fs.rm(root, { recursive: true, force: true });
  });
});
