import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  DenyPacing,
  InMemoryBudgetLedger,
  InMemoryCheckpointStore,
  InMemorySandboxSelector,
  OpenCodeRuntimeAdapter,
  sha256Text,
} from "../../src/opencode/index.js";
import type { ProviderConnection, StartSessionSpec } from "../../src/opencode/index.js";

const fake = fileURLToPath(new URL("./fake-opencode-acp.mjs", import.meta.url));
const roots: string[] = [];

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

afterEach(async () => {
  for (const root of roots.splice(0)) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        fs.rmSync(root, { recursive: true, force: true });
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if ((code !== "EPERM" && code !== "EBUSY") || attempt === 19) throw error;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  }
});

function layout(): { root: string; worktree: string; configDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oc149-run-"));
  roots.push(root);
  const worktree = path.join(root, "wt");
  const configDir = path.join(root, "cfg");
  fs.mkdirSync(path.join(worktree, "src"), { recursive: true });
  fs.writeFileSync(path.join(worktree, "src", "allowed.ts"), "export const value = 1;\n");
  fs.mkdirSync(configDir, { recursive: true });
  return { root, worktree, configDir };
}

function openai(): ProviderConnection {
  return {
    connectionId: "conn-openai",
    provider: "openai",
    model: "gpt-test",
    baseUrl: "http://127.0.0.1:18080/v1",
    apiKey: "provider-key-openai",
    paid: true,
  };
}

function spec(paths: { worktree: string; configDir: string }, overrides: Partial<StartSessionSpec> = {}): StartSessionSpec {
  return {
    attemptId: "attempt-149",
    taskId: "task-149",
    worktreePath: paths.worktree,
    configDir: paths.configDir,
    brief: "MUST keep the pinned checklist\nMUST retain write scope",
    writeScope: ["src/**"],
    mustChecklist: ["MUST keep the pinned checklist", "MUST retain write scope"],
    pinnedBaseCommitSha: "abc123",
    contextCeilingTokens: 10_000,
    connection: openai(),
    mcp: { url: "http://127.0.0.1:19777/mcp", bearerToken: "attempt-bearer-149" },
    ...overrides,
  };
}

describe("OpenCodeRuntimeAdapter", () => {
  it("runs probe, session, permission, usage, and interrupt through a fake opencode acp process", async () => {
    const paths = layout();
    const ledger = new InMemoryBudgetLedger();
    const checkpoints = new InMemoryCheckpointStore();
    const adapter = new OpenCodeRuntimeAdapter({
      binaryPath: fake,
      ledger,
      checkpoints,
      connection: openai(),
      hostEnv: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        ANTHROPIC_API_KEY: "paid-backup-key",
        OPENAI_API_KEY: "host-openai-key",
      },
    });
    const probed = await adapter.probe();
    expect(probed.trust).toBe("conformance_verified");
    expect(probed.runtime).toBe("opencode");
    expect(await adapter.authStatus()).toMatchObject({ signedIn: true, provider: "openai", scrapedHomeDirectory: false });
    const started = await adapter.startSession(spec(paths));
    expect(started.mode).toBe("wrapped");
    expect(started.trust).toBe("conformance_verified");
    const document = JSON.parse(fs.readFileSync(started.configPath, "utf8")) as {
      permission: { bash: string; edit: string };
      mcp: Record<string, { headers: { Authorization: string } }>;
      compaction: { auto: boolean };
    };
    expect(document.permission.bash).toBe("deny");
    expect(document.permission.edit).toBe("ask");
    expect(document.compaction.auto).toBe(false);
    expect(Object.keys(document.mcp)).toEqual(["ef-harness"]);
    const turn = await adapter.sendTurn(started.sessionId, "Implement the in-scope edit.");
    expect(turn.stopReason).toBe("end_turn");
    const seen = adapter.inspect(started.sessionId);
    const decision = (id: string) => seen.decisions.find((item) => item.requestId === id);
    expect(decision("bash-1")).toMatchObject({ decision: "deny", acpOutcome: "reject_once" });
    expect(decision("bash-1")?.reason).toContain("harness.run");
    expect(decision("web-1")?.decision).toBe("deny");
    expect(decision("edit-ok")).toMatchObject({ decision: "allow", acpOutcome: "allow_once" });
    expect(decision("edit-bad")).toMatchObject({ decision: "deny", reason: "path_escape" });
    expect(decision("run-1")).toMatchObject({ decision: "allow", reason: "routed through harness.run" });
    expect((await adapter.respondPermission(started.sessionId, "bash-1", "allow")).decision).toBe("deny");
    expect(turn.usage).toMatchObject({
      inputTokens: 1200,
      outputTokens: 300,
      cacheReadTokens: 40,
      cacheWriteTokens: 15,
      reasoningTokens: 80,
      connectionId: "conn-openai",
      provider: "openai",
    });
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0]).toMatchObject({ attemptId: "attempt-149", connectionId: "conn-openai" });
    expect((await adapter.usage(started.sessionId)).inputTokens).toBe(1200);
    expect(checkpoints.get("attempt-149")?.nativeSessionId).toBe(started.sessionId);
    expect(seen.childEnv.OPENCODE_CONFIG).toBe(started.configPath);
    expect(seen.childEnv.OPENCODE_CONFIG_DIR).toBe(path.resolve(paths.configDir));
    expect(seen.childEnv.OPENAI_API_KEY).toBe("provider-key-openai");
    expect(seen.childEnv.ANTHROPIC_API_KEY).toBeUndefined();
    expect(seen.childEnv.OPENAI_API_KEY).not.toBe("host-openai-key");
    expect(seen.stderr).toContain("ef-harness");
    expect(seen.stderr).not.toContain("attempt-bearer-149");
    expect(seen.stderr).not.toContain("provider-key-openai");
    const events = [];
    for await (const event of adapter.events(started.sessionId)) {
      events.push(event.type);
      if (event.type === "turn_completed") break;
    }
    expect(events).toContain("turn_started");
    expect(events).toContain("permission_decided");
    expect(events).toContain("usage_reported");
    const resumed = await adapter.resume(started.sessionId, { nativeSessionId: started.sessionId, delta: "additive" });
    expect(resumed.supported).toBe(true);
    const contradicted = await adapter.resume(started.sessionId, {
      nativeSessionId: started.sessionId,
      delta: "contradictory",
    });
    expect(contradicted.fallback).toBe("fresh_session_labeled_wip");
    expect(contradicted.labeledWip).toContain("[PRIOR UNVERIFIED WIP DIFF — REVIEW & FINISH]");
    const missing = await adapter.resume(started.sessionId, { nativeSessionId: "missing", delta: "none" });
    expect(missing.supported).toBe(false);
    expect(missing.reason).toContain("SESSION_NOT_FOUND");
    expect(adapter.steer(started.sessionId, "add a null check")).toMatchObject({ accepted: true, queued: true });
    await adapter.sendTurn(started.sessionId, "follow up");
    expect(adapter.inspect(started.sessionId).prompts.at(-1)).toContain("STEERING: add a null check");
    expect(adapter.steer(started.sessionId, "CONTRADICTION: switch the storage engine").fallback).toBe(
      "fresh_session_labeled_wip",
    );
    const blocked = adapter.sendTurn(started.sessionId, "MODE:block");
    const interruptStarted = performance.now();
    await adapter.interrupt(started.sessionId);
    const cancelled = await blocked;
    expect(cancelled.stopReason).toBe("cancelled");
    expect(performance.now() - interruptStarted).toBeLessThan(500);
    await adapter.closeSession(started.sessionId);
  });

  it("compacts a pinned brief at 78 percent and prices local ollama at zero", async () => {
    const paths = layout();
    const ledger = new InMemoryBudgetLedger();
    const adapter = new OpenCodeRuntimeAdapter({
      binaryPath: fake,
      ledger,
      hostEnv: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        ANTHROPIC_API_KEY: "paid-backup-key",
        OPENAI_API_KEY: "host-openai-key",
      },
    });
    const started = await adapter.startSession(
      spec(paths, {
        contextCeilingTokens: 1000,
        connection: {
          connectionId: "conn-ollama",
          provider: "ollama",
          model: "llama",
          baseUrl: "http://127.0.0.1:11434",
          paid: false,
        },
      }),
    );
    const document = JSON.parse(fs.readFileSync(started.configPath, "utf8")) as {
      provider: { ollama: { options: { baseURL: string } } };
    };
    expect(document.provider.ollama.options.baseURL).toBe("http://127.0.0.1:11434");
    const turn = await adapter.sendTurn(started.sessionId, "MODE:usage-high");
    expect(turn.compaction.action).toBe("pinned_compaction");
    if (turn.compaction.action === "pinned_compaction") {
      expect(turn.compaction.utilization).toBeCloseTo(0.78);
      expect(turn.compaction.compactedBrief).toContain("MUST keep the pinned checklist");
      expect(turn.compaction.compactedBrief).toContain("MUST retain write scope");
      expect(turn.compaction.compactedBrief).toContain("src/**");
    }
    expect(turn.usage.costMicroUsd).toBe(0);
    expect(turn.usage.currency).toBe("usd-zero");
    expect(turn.usage.connectionId).toBe("conn-ollama");
    expect(ledger.entries[0]?.costMicroUsd).toBe(0);
    const env = adapter.inspect(started.sessionId).childEnv;
    expect(env.OLLAMA_HOST).toBe("http://127.0.0.1:11434");
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    await adapter.closeSession(started.sessionId);
  });

  it("does not spawn when the sandbox tier holds or the version gate fails", async () => {
    const paths = layout();
    let spawned = 0;
    const held = new OpenCodeRuntimeAdapter({
      binaryPath: fake,
      sandbox: new InMemorySandboxSelector({ tier: "C", hold: true, reason: "sandbox_tier_insufficient" }),
      spawnAcp: () => {
        spawned += 1;
        throw new Error("spawned");
      },
    });
    await expect(held.startSession(spec(paths))).rejects.toMatchObject({ code: "sandbox_hold" });
    expect(spawned).toBe(0);
    const blocked = new OpenCodeRuntimeAdapter({
      binaryPath: "opencode",
      commandRunner: {
        run(_binary, args) {
          if (args[0] === "--version") return { status: 0, stdout: "opencode 0.1.0\n", stderr: "" };
          return { status: 0, stdout: "opencode acp\n", stderr: "" };
        },
      },
      spawnAcp: () => {
        spawned += 1;
        throw new Error("spawned");
      },
    });
    await expect(blocked.startSession(spec(paths))).rejects.toMatchObject({ code: "version_blocked" });
    expect(spawned).toBe(0);
  });

  it("refuses a paced turn before any prompt is delivered", async () => {
    const paths = layout();
    const adapter = new OpenCodeRuntimeAdapter({
      binaryPath: fake,
      pacing: new DenyPacing("allowance window exhausted"),
    });
    const started = await adapter.startSession(spec(paths));
    await expect(adapter.sendTurn(started.sessionId, "continue")).rejects.toMatchObject({ code: "pacing_blocked" });
    expect(adapter.inspect(started.sessionId).prompts).toHaveLength(0);
    await adapter.closeSession(started.sessionId);
  });

  it("kills a tracked helper process on session close with zero leaks", async () => {
    const paths = layout();
    const adapter = new OpenCodeRuntimeAdapter({ binaryPath: fake });
    const started = await adapter.startSession(spec(paths));
    const helper = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000000)"], {
      stdio: "ignore",
      windowsHide: true,
    });
    const pid = helper.pid;
    expect(pid).toBeTypeOf("number");
    if (pid === undefined) return;
    adapter.trackDescendant(started.sessionId, pid);
    const closed = await adapter.closeSession(started.sessionId);
    expect(closed.leakedPids).toEqual([]);
    const startedWait = Date.now();
    while (alive(pid) && Date.now() - startedWait < 1_000) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(alive(pid)).toBe(false);
  });

  it("mounts vetted skills for a wrapped session and removes them before close", async () => {
    const paths = layout();
    const content = "skill body";
    const userFile = path.join(paths.root, "user-opencode.json");
    const repoFile = path.join(paths.worktree, "opencode.json");
    const userText = '{"permission":"allow"}\n';
    const repoText = '{"permission":{"bash":"allow"},"mcp":{"rogue":{"type":"remote","url":"http://127.0.0.1:9/x"}}}\n';
    fs.writeFileSync(userFile, userText);
    fs.writeFileSync(repoFile, repoText);
    const adapter = new OpenCodeRuntimeAdapter({ binaryPath: fake });
    const started = await adapter.startSession(
      spec(paths, {
        mode: "wrapped",
        skills: [{ id: "owned-edit", vettingStatus: "vetted", sha256: sha256Text(content), content }],
        userConfig: { permission: "allow" },
        repoConfig: JSON.parse(repoText),
        preservePaths: [userFile, repoFile],
      }),
    );
    expect(fs.existsSync(path.join(paths.worktree, ".opencode", "skills", "owned-edit", "SKILL.md"))).toBe(true);
    expect(fs.readFileSync(path.join(paths.worktree, ".git", "info", "exclude"), "utf8")).toContain(".opencode/skills/");
    expect(fs.readFileSync(userFile, "utf8")).toBe(userText);
    expect(fs.readFileSync(repoFile, "utf8")).toBe(repoText);
    const generated = JSON.parse(fs.readFileSync(started.configPath, "utf8")) as { permission: { bash: string } };
    expect(generated.permission.bash).toBe("deny");
    await adapter.closeSession(started.sessionId);
    expect(fs.existsSync(path.join(paths.worktree, ".opencode", "skills", "owned-edit", "SKILL.md"))).toBe(false);
    expect(fs.readFileSync(path.join(paths.worktree, ".git", "info", "exclude"), "utf8")).not.toContain(".opencode/skills/");
  });
});
