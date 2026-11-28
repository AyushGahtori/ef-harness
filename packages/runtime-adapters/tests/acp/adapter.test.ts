import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  AcpFrameParser,
  AcpHostFsAndTerminalBridge,
  AcpProtocolError,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_FRAME_BYTES,
  LocalLeasedMcpServer,
  LocalPacketSecurityRedactor,
  LocalSkillMounter,
  LocalSupervisionPolicy,
  LocalTurnLog,
  LocalWarmExecutionPool,
  NormalizedRuntimeEventBus,
  SkillMountDeniedError,
  WAITING_FOR_RUN_SLOT,
  assertPermissionBudget,
  createGenericAcpAdapter,
  isAlive,
} from "../../src/acp/index.js";
import type { AcpRuntimeProfile, HarnessRunPort, SandboxedCommandResult, WindowsJobPort } from "../../src/acp/index.js";

const fakeServer = fileURLToPath(new URL("./fake-acp-server.mjs", import.meta.url));

function worktree(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ef-acp-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, ".git", "info"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "app.ts"), "alpha\nbeta\ngamma\n", "utf8");
  fs.writeFileSync(path.join(root, "README.md"), "readme", "utf8");
  return root;
}

function profile(): AcpRuntimeProfile {
  return {
    id: "generic",
    command: process.execPath,
    args: [fakeServer],
    version: "1.2.0",
    envAllowlist: ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "COMSPEC", "WINDIR", "TEMP", "TMP"],
    quirks: {
      protocolVersion: 1,
      mcpTransport: "http",
      tolerateStdoutBanner: true,
      steerMethod: "queue",
    },
  };
}

function recordingHarness(hold?: (command: string) => Promise<void>): HarnessRunPort & { commands: string[] } {
  const commands: string[] = [];
  return {
    commands,
    executeSandboxedCommand(request): Promise<SandboxedCommandResult> {
      commands.push(request.command);
      const run = async (): Promise<SandboxedCommandResult> => {
        if (hold && request.command.startsWith("node hold")) await hold(request.command);
        if (request.signal?.aborted) {
          return {
            exitCode: 1,
            timedOut: false,
            stdoutSummary: "",
            stderrSummary: "killed",
            commandId: "killed",
            durationMs: 1,
          };
        }
        return {
          exitCode: 0,
          timedOut: false,
          stdoutSummary: request.command === "vitest run" ? "vitest-ok" : "ok",
          stderrSummary: "",
          commandId: `cmd-${commands.length}`,
          durationMs: 1,
        };
      };
      return run();
    },
  };
}

async function waitDead(pid: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 2_000) {
    if (!isAlive(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`pid ${pid} is still running`);
}

describe("ACP supervision and mounts", () => {
  it("allows in-scope edits and vitest, and rejects escapes", () => {
    const root = worktree();
    const linkParent = fs.mkdtempSync(path.join(os.tmpdir(), "ef-acp-link-"));
    const secret = path.join(linkParent, "secret.txt");
    fs.writeFileSync(secret, "hidden", "utf8");
    fs.symlinkSync(linkParent, path.join(root, "escape"), "junction");
    const policy = new LocalSupervisionPolicy();
    const context = {
      worktreeRoot: root,
      writeScope: ["src/**"],
      mode: "wrapped" as const,
      homeDir: os.homedir(),
    };
    for (let index = 0; index < 5; index += 1) policy.decide(context, { kind: "read", path: path.join(root, "src", "app.ts") });
    const read = policy.decide(context, { kind: "read", path: path.join(root, "src", "app.ts") });
    const write = policy.decide(context, { kind: "edit", path: path.join(root, "src", "app.ts") });
    const ssh = policy.decide(context, { kind: "read", path: path.join(os.homedir(), ".ssh", "id_ed25519") });
    const outside = policy.decide(context, { kind: "edit", path: path.join(root, "README.md") });
    const symlink = policy.decide(context, { kind: "read", path: path.join(root, "escape", "secret.txt") });
    const push = policy.decide(context, { kind: "shell", command: "git push --force origin main" });
    const vitest = policy.decide(context, { kind: "shell", command: "vitest run" });
    const install = policy.decide(context, { kind: "shell", command: "pnpm add axios" });
    expect(read.effect).toBe("allow");
    expect(write.effect).toBe("allow");
    assertPermissionBudget(read);
    assertPermissionBudget(write);
    expect(ssh.effect).toBe("deny");
    expect(outside.effect).toBe("deny");
    expect(symlink.effect).toBe("deny");
    expect(push.effect).toBe("deny");
    expect(vitest.effect).toBe("redirect");
    expect(install.effect).toBe("deny");
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(linkParent, { recursive: true, force: true });
  });

  it("mounts vetted skills inside the worktree exclude list and refuses global config", () => {
    const root = worktree();
    const mounter = new LocalSkillMounter();
    const mounted = mounter.mount({
      worktreeRoot: root,
      attemptId: "attempt-1",
      skills: [
        { skillId: "alpha", vetted: true, files: [{ relativePath: "skill.md", text: "Use the worktree." }] },
        { skillId: "beta", vetted: true, files: [{ relativePath: "skill.md", text: "Stay local." }] },
      ],
    });
    expect(mounted.mountPath.startsWith(root)).toBe(true);
    expect(fs.existsSync(path.join(mounted.mountPath, "alpha", "skill.md"))).toBe(true);
    const exclude = fs.readFileSync(mounted.excludePath, "utf8");
    expect(exclude).toContain("/.ef-skills/");
    expect(() =>
      mounter.mount({
        worktreeRoot: root,
        attemptId: "attempt-2",
        skills: [
          { skillId: "a", vetted: true, files: [] },
          { skillId: "b", vetted: true, files: [] },
          { skillId: "c", vetted: true, files: [] },
        ],
      }),
    ).toThrow(SkillMountDeniedError);
    expect(() =>
      mounter.mount({
        worktreeRoot: root,
        attemptId: "attempt-3",
        skills: [{ skillId: "raw", vetted: false, files: [{ relativePath: "skill.md", text: "no" }] }],
      }),
    ).toThrow(SkillMountDeniedError);
    const globalPath = path.join(os.homedir(), ".codex", "ef-acp-should-not-exist");
    expect(() =>
      mounter.mount({
        worktreeRoot: globalPath,
        attemptId: "attempt-4",
        skills: [{ skillId: "alpha", vetted: true, files: [{ relativePath: "skill.md", text: "no" }] }],
      }),
    ).toThrow(SkillMountDeniedError);
    expect(fs.existsSync(globalPath)).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("rejects oversized frames and keeps stderr out of the parser", () => {
    expect(DEFAULT_MAX_FRAME_BYTES).toBe(8 * 1024 * 1024);
    expect(DEFAULT_MAX_FILE_BYTES).toBe(4 * 1024 * 1024);
    const parser = new AcpFrameParser(64);
    const banner = parser.push(Buffer.from('Welcome to Agent v1.2!\n{"jsonrpc":"2.0","id":1,"result":{}}\n'));
    expect(banner.error).toBeNull();
    expect(banner.messages).toHaveLength(1);
    expect(parser.startupBanners).toEqual(["Welcome to Agent v1.2!"]);
    const corrupt = new AcpFrameParser(64);
    corrupt.push(Buffer.from('{"jsonrpc":"2.0","method":"session/update"}\n'));
    const broken = corrupt.push(Buffer.from("NOT_JSON\n"));
    expect(broken.error).toBeInstanceOf(AcpProtocolError);
    expect(broken.error && "code" in broken.error ? broken.error.code : "").toBe("framing_corruption");
    const huge = new AcpFrameParser(32);
    const oversized = huge.push(Buffer.from(`${"x".repeat(40)}\n`));
    expect(oversized.error).toBeInstanceOf(AcpProtocolError);
    expect(oversized.error && "code" in oversized.error ? oversized.error.code : "").toBe("oversized_frame");
  });
});

describe("generic ACP child process", () => {
  let root = "";
  let sessionId = "";
  let adapter: ReturnType<typeof createGenericAcpAdapter> | null = null;

  afterEach(async () => {
    const current = adapter;
    const id = sessionId;
    adapter = null;
    sessionId = "";
    if (current && id) {
      try {
        await current.stop(id);
      } catch (error) {
        if (!(error instanceof AcpProtocolError)) throw error;
      }
    }
    if (root) {
      await removeTree(root);
      root = "";
    }
  });

  it("runs initialize, session/new, prompt, updates, usage, and exit", async () => {
    root = worktree();
    const mcp = new LocalLeasedMcpServer();
    const harness = recordingHarness();
    adapter = createGenericAcpAdapter({
      profile: profile(),
      mcp,
      harness,
      initializeTimeoutMs: 2_000,
    });
    const opened = await adapter.startSession({
      attemptId: "attempt-1",
      taskId: "task-1",
      sessionId: "sess-1",
      worktreeRoot: root,
      writeScope: ["src/**"],
      skills: [
        { skillId: "alpha", vetted: true, files: [{ relativePath: "skill.md", text: "Use the worktree." }] },
      ],
      env: {
        EF_ACP_SCENARIO: "lifecycle",
        OPENAI_API_KEY: "blocked-value",
      },
      secrets: [{ label: "demo", value: "demo-secret-value" }],
    });
    sessionId = opened.sessionId;
    expect(fs.existsSync(path.join(root, ".ef-skills", "attempt-1", "alpha", "skill.md"))).toBe(true);
    expect(fs.readFileSync(path.join(root, ".git", "info", "exclude"), "utf8")).toContain("/.ef-skills/");
    const turn = await adapter.sendTurn(sessionId, "ship the brief");
    expect(turn.stopReason).toBe("end_turn");
    const types = adapter.eventsBus.snapshot(sessionId).map((event) => event.type);
    expect(types).toContain("assistant_delta");
    expect(types).toContain("plan_updated");
    expect(types).toContain("tool_call_requested");
    expect(types).toContain("usage_reported");
    expect(types).toContain("turn_completed");
    const usage = await adapter.usage(sessionId);
    expect(usage).toMatchObject({ inputTokens: 10, cachedInputTokens: 1, outputTokens: 4, reasoningTokens: 2, costMicroUsd: 5 });
    const view = adapter.inspect(sessionId);
    expect(view.stderr.some((line) => line.includes("stderr stays off the rpc stream"))).toBe(true);
    expect(view.stderr.some((line) => line.includes("openai absent"))).toBe(true);
    expect(view.stderr.some((line) => line.includes("mcp-bearer present"))).toBe(true);
    expect(view.stderr.some((line) => line.includes("kb.*,harness.run,harness.read_result"))).toBe(true);
    const token = JSON.stringify(view.mcpServers);
    expect(adapter.turnLog.text(sessionId).includes("Bearer ef_attempt_")).toBe(false);
    expect(token.includes("Bearer ")).toBe(true);
    fs.writeFileSync(path.join(root, ".ef-skills", "skill.md"), "left behind", "utf8");
    const resumed = await adapter.resume(sessionId, "checkpoint-1");
    expect(resumed.supported).toBe(true);
    const pid = view.pid;
    await adapter.stop(sessionId);
    if (pid !== null) await waitDead(pid);
    expect(fs.existsSync(path.join(root, ".ef-skills"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".ef-mcp"))).toBe(false);
    expect(mcp.isRevoked("lease-attempt-1-1")).toBe(true);
    expect(isAlive(pid ?? -1)).toBe(false);
  });

  it("serves fs and terminal allow and deny through the fake agent", async () => {
    root = worktree();
    const linkParent = fs.mkdtempSync(path.join(os.tmpdir(), "ef-acp-link-"));
    fs.writeFileSync(path.join(linkParent, "secret.txt"), "hidden", "utf8");
    const link = path.join(root, "escape");
    fs.symlinkSync(linkParent, link, "junction");
    const harness = recordingHarness();
    adapter = createGenericAcpAdapter({ profile: profile(), harness, initializeTimeoutMs: 2_000 });
    const allowPath = path.join(root, "src", "app.ts");
    const opened = await adapter.startSession({
      attemptId: "attempt-fs",
      taskId: "task-fs",
      sessionId: "sess-fs",
      worktreeRoot: root,
      writeScope: ["src/**"],
      env: {
        EF_ACP_SCENARIO: "fs-terminal",
        EF_ACP_ALLOW_PATH: allowPath,
        EF_ACP_DENY_PATH: path.join(root, "README.md"),
        EF_ACP_SSH_PATH: path.join(os.homedir(), ".ssh", "id_ed25519"),
        EF_ACP_SYMLINK_PATH: path.join(link, "secret.txt"),
      },
    });
    sessionId = opened.sessionId;
    const turn = await adapter.sendTurn(sessionId, "edit the file");
    expect(turn.stopReason).toBe("end_turn");
    const stderr = adapter.inspect(sessionId).stderr.join("\n");
    expect(stderr).toContain("read-allow alpha\nbeta");
    expect(stderr).toContain("read-ssh -32003");
    expect(stderr).toContain("read-symlink -32003");
    expect(stderr).toContain("write-deny -32003");
    expect(stderr).toContain("push -32003");
    expect(stderr).toContain("vitest 0 vitest-ok");
    expect(stderr).toContain('"kind":"reject_once"');
    expect(fs.readFileSync(allowPath, "utf8")).toBe("updated\n");
    expect(harness.commands).toEqual(["vitest run"]);
    expect(adapter.securityEvents().some((event) => event.method === "terminal/create")).toBe(true);
    fs.rmSync(linkParent, { recursive: true, force: true });
  });

  it("queues vitest on a full Pool 2 and still runs it", async () => {
    root = worktree();
    let releaseHolds = (): void => undefined;
    let released = false;
    const held: Array<() => void> = [];
    const hold = (): Promise<void> => {
      if (released) return Promise.resolve();
      return new Promise((resolve) => held.push(resolve));
    };
    releaseHolds = () => {
      released = true;
      for (const resolve of held) resolve();
      held.length = 0;
    };
    const harness = recordingHarness(async () => hold());
    const events = new NormalizedRuntimeEventBus();
    adapter = createGenericAcpAdapter({
      profile: profile(),
      harness,
      events,
      initializeTimeoutMs: 2_000,
    });
    events.subscribe((event) => {
      if (event.type === "waiting_run_slot") setTimeout(releaseHolds, 30);
    });
    const opened = await adapter.startSession({
      attemptId: "attempt-pool",
      taskId: "task-pool",
      sessionId: "sess-pool",
      worktreeRoot: root,
      writeScope: ["src/**"],
      env: { EF_ACP_SCENARIO: "pool" },
    });
    sessionId = opened.sessionId;
    const turn = await adapter.sendTurn(sessionId, "run tests");
    expect(turn.stopReason).toBe("end_turn");
    const waiting = events.snapshot(sessionId).filter((event) => event.type === "waiting_run_slot");
    expect(waiting.length).toBeGreaterThan(0);
    expect(waiting[0]?.payload.status).toBe(WAITING_FOR_RUN_SLOT);
    expect(harness.commands).toEqual(["node hold-a", "node hold-b", "vitest run"]);
    expect(adapter.inspect(sessionId).stderr.some((line) => line.includes("pool 3"))).toBe(true);
  });

  it("cancels a pending permission in under 500 ms and reaps the child", async () => {
    root = worktree();
    const jobs = new TrackingJob();
    const events = new NormalizedRuntimeEventBus();
    adapter = createGenericAcpAdapter({
      profile: profile(),
      jobs,
      events,
      initializeTimeoutMs: 2_000,
      cancelGraceMs: 200,
    });
    const opened = await adapter.startSession({
      attemptId: "attempt-cancel",
      taskId: "task-cancel",
      sessionId: "sess-cancel",
      worktreeRoot: root,
      writeScope: ["src/**"],
      env: {
        EF_ACP_SCENARIO: "permission-cancel",
        EF_ACP_ALLOW_PATH: path.join(root, "src", "app.ts"),
      },
    });
    sessionId = opened.sessionId;
    const pid = adapter.inspect(sessionId).pid ?? -1;
    let started = 0;
    events.subscribe((event) => {
      if (event.type !== "permission_requested" || !adapter) return;
      started = performance.now();
      void adapter.interrupt(sessionId);
    });
    const turn = await adapter.sendTurn(sessionId, "wait for permission");
    expect(performance.now() - started).toBeLessThan(500);
    expect(turn).toEqual({ stopReason: "cancelled", cancelled: true });
    await waitForText(adapter, sessionId, '"outcome":"cancelled"');
    const stderr = adapter.inspect(sessionId).stderr.join("\n");
    expect(stderr).toContain('"outcome":"cancelled"');
    expect(stderr).toContain('"kind":"reject_once"');
    expect(stderr).toContain("cancel received");
    await waitDead(pid);
    expect(jobs.activeChildCount(`job-${sessionId}`)).toBe(0);
    expect(isAlive(pid)).toBe(false);
  });

  it("reports loadSession false without calling session/load", async () => {
    root = worktree();
    adapter = createGenericAcpAdapter({ profile: profile(), initializeTimeoutMs: 2_000 });
    const opened = await adapter.startSession({
      attemptId: "attempt-load",
      taskId: "task-load",
      sessionId: "sess-load",
      worktreeRoot: root,
      writeScope: ["src/**"],
      env: { EF_ACP_SCENARIO: "no-load" },
    });
    sessionId = opened.sessionId;
    await adapter.sendTurn(sessionId, "hello");
    const resumed = await adapter.resume(sessionId);
    expect(resumed).toEqual({ supported: false, reason: "unsupported_resume" });
    expect(adapter.inspect(sessionId).stderr.some((line) => line.includes("load-requests"))).toBe(false);
  });

  it("accepts one stdout banner and fails closed on corruption, flood, and initialize timeout", async () => {
    root = worktree();
    adapter = createGenericAcpAdapter({ profile: profile(), initializeTimeoutMs: 2_000 });
    const banner = await adapter.startSession({
      attemptId: "attempt-banner",
      taskId: "task-banner",
      sessionId: "sess-banner",
      worktreeRoot: root,
      writeScope: ["src/**"],
      env: { EF_ACP_SCENARIO: "banner" },
    });
    sessionId = banner.sessionId;
    expect(adapter.inspect(sessionId).banners).toContain("Welcome to Agent v1.2!");
    await adapter.sendTurn(sessionId, "hello");
    const bannerPid = adapter.inspect(sessionId).pid;
    await adapter.stop(sessionId);
    if (bannerPid !== null) await waitDead(bannerPid);
    sessionId = "";

    await expect(startBroken(root, "corrupt")).rejects.toMatchObject({ code: "framing_corruption" });
    await expect(startBroken(root, "version-mismatch")).rejects.toMatchObject({ code: "version_mismatch" });
    await expect(startBroken(root, "capability-mismatch")).rejects.toMatchObject({ code: "capability_mismatch" });
    await expect(startBroken(root, "flood")).rejects.toMatchObject({ code: "unknown_method_flood" });
    await expect(startBroken(root, "double-banner")).rejects.toMatchObject({ code: "framing_corruption" });
    const slow = createGenericAcpAdapter({ profile: profile(), initializeTimeoutMs: 200 });
    await expect(
      slow.startSession({
        attemptId: "attempt-hang",
        taskId: "task-hang",
        sessionId: "sess-hang",
        worktreeRoot: root,
        writeScope: ["src/**"],
        env: { EF_ACP_SCENARIO: "hang-init" },
      }),
    ).rejects.toMatchObject({ code: "initialize_timeout" });
  }, 20_000);
});

async function removeTree(target: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? error.code : "";
      if (code !== "EPERM" && code !== "EBUSY" && code !== "ENOTEMPTY") throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  fs.rmSync(target, { recursive: true, force: true });
}

async function waitForText(
  adapter: { inspect(sessionId: string): { stderr: readonly string[] } },
  sessionId: string,
  needle: string,
): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (adapter.inspect(sessionId).stderr.join("\n").includes(needle)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function startBroken(root: string, scenario: string): Promise<void> {
  const jobs = new TrackingJob();
  const adapter = createGenericAcpAdapter({ profile: profile(), jobs, initializeTimeoutMs: 2_000 });
  try {
    await adapter.startSession({
      attemptId: `attempt-${scenario}`,
      taskId: `task-${scenario}`,
      sessionId: `sess-${scenario}`,
      worktreeRoot: root,
      writeScope: ["src/**"],
      env: { EF_ACP_SCENARIO: scenario },
    });
  } finally {
    const pid = jobs.list(`job-sess-${scenario}`)[0];
    if (pid !== undefined) await waitDead(pid);
  }
}

describe("host fs bridge byte cap", () => {
  it("rejects a write above the configured cap and slices line ranges", () => {
    const root = worktree();
    const events = new NormalizedRuntimeEventBus();
    const bridge = new AcpHostFsAndTerminalBridge(
      new LocalSupervisionPolicy(),
      recordingHarness(),
      new TrackingJob(),
      events,
      new LocalPacketSecurityRedactor(),
      new LocalWarmExecutionPool(2),
      32,
    );
    const session = {
      sessionId: "sess",
      attemptId: "attempt",
      taskId: "task",
      worktreeRoot: root,
      cwd: root,
      writeScope: ["src/**"],
      mode: "wrapped" as const,
      jobId: "job-sess",
    };
    const read = bridge.readTextFile(session, { sessionId: "sess", path: path.join(root, "src", "app.ts"), line: 2, limit: 1 });
    expect(read.content).toBe("beta");
    expect(() =>
      bridge.writeTextFile(session, {
        sessionId: "sess",
        path: path.join(root, "src", "app.ts"),
        content: "0123456789".repeat(4),
      }),
    ).toThrow(/byte cap/);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

class TrackingJob implements WindowsJobPort {
  private readonly jobs = new Map<string, Set<number>>();

  create(sessionId: string): { readonly jobId: string } {
    const jobId = `job-${sessionId}`;
    if (this.jobs.has(jobId)) throw new Error(`Job ${jobId} already exists`);
    this.jobs.set(jobId, new Set());
    return { jobId };
  }

  attach(jobId: string, pid: number): void {
    const pids = this.jobs.get(jobId);
    if (!pids) throw new Error(`Unknown job ${jobId}`);
    pids.add(pid);
  }

  list(jobId: string): readonly number[] {
    return [...(this.jobs.get(jobId) ?? [])].filter((pid) => isAlive(pid));
  }

  activeChildCount(jobId: string): number {
    return this.list(jobId).length;
  }

  kill(jobId: string, reason: string): readonly number[] {
    void reason;
    const pids = [...(this.jobs.get(jobId) ?? [])];
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        continue;
      }
    }
    this.jobs.set(jobId, new Set());
    return pids;
  }

  close(jobId: string): void {
    this.kill(jobId, "close");
    this.jobs.delete(jobId);
  }
}

describe("turn log redaction", () => {
  it("stores only redacted wire text", () => {
    const redactor = new LocalPacketSecurityRedactor();
    redactor.register("mcp-bearer", "ef_attempt_visible_token");
    const log = new LocalTurnLog(redactor);
    log.append({ sessionId: "sess", kind: "acp_wire", text: "Bearer ef_attempt_visible_token" });
    expect(log.text("sess")).toContain("[REDACTED:mcp-bearer]");
    expect(log.text("sess")).not.toContain("ef_attempt_visible_token");
  });
});
