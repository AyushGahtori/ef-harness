import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CodexRuntimeAdapter } from "../../src/codex/adapter.js";
import { CodexRateLimitBridge } from "../../src/codex/rate-limit.js";
import { LABELED_WIP_HEADER } from "../../src/codex/types.js";
import { LocalWindowsJob } from "../../src/codex/process.js";
import {
  LocalBurnRateWindowTracker,
  LocalLabeledWipRebuilder,
  LocalModelAllowanceWeightLearner,
  LocalResumeHandoff,
  LocalSteeringDisposition,
  LocalWipSnapshot,
  MemoryCheckpointStore,
  type TierAMxcSandboxPort,
} from "../../src/codex/ports.js";
import {
  acpScript,
  apiKeyConnection,
  appServerScript,
  isAlive,
  killPidFile,
  killRecords,
  makeWorkspace,
  readLog,
  recordingSpawn,
  siwc,
  waitFor,
  type SpawnRecord,
} from "./helpers.js";

const open: Array<{ records: SpawnRecord[]; childPid?: string; cleanup: () => void; adapter?: CodexRuntimeAdapter; sessionId?: string }> = [];

afterEach(async () => {
  const pending = open.splice(0, open.length);
  for (const item of pending) {
    if (item.adapter && item.sessionId) {
      await item.adapter.shutdown(item.sessionId).catch(() => undefined);
    }
  }
  for (const item of pending) {
    killRecords(item.records);
    if (item.childPid) killPidFile(item.childPid);
  }
  await new Promise((resolve) => {
    setTimeout(resolve, 30);
  });
  for (const item of pending) item.cleanup();
});

function fakeEnv(input: { args: readonly string[] }, fields: Record<string, string>): NodeJS.ProcessEnv {
  const script = input.args[0] ?? "";
  const scenario = script.includes("fake-codex-acp") ? fields.ACP_SCENARIO ?? "stream" : fields.EF_FAKE_SCENARIO ?? "stream";
  const env: NodeJS.ProcessEnv = { EF_FAKE_SCENARIO: scenario };
  for (const [key, value] of Object.entries(fields)) {
    if (key === "ACP_SCENARIO") continue;
    env[key] = value;
  }
  env.EF_FAKE_SCENARIO = scenario;
  return env;
}

describe("codex app-server runtime adapter", () => {
  it("streams a turn, checkpoints the thread, and keeps the personal Codex home untouched", async () => {
    const workspace = makeWorkspace();
    const records: SpawnRecord[] = [];
    const log = path.join(workspace.root, "fake.log");
    const burn = new LocalBurnRateWindowTracker();
    const weights = new LocalModelAllowanceWeightLearner();
    const checkpoints = new MemoryCheckpointStore();
    const adapter = new CodexRuntimeAdapter({
      versionReader: async () => "1.2.3",
      spawner: recordingSpawn(records, (input) =>
        fakeEnv(input, { EF_FAKE_SCENARIO: "stream", EF_FAKE_LOG: log, EF_FAKE_DELTA: "hello" }),
      ),
      command: process.execPath,
      appServerArgs: [appServerScript],
      acpCommand: process.execPath,
      acpArgs: [acpScript],
      userHome: workspace.userHome,
      codexHomeRoot: workspace.codexHomeRoot,
      hostEnv: {
        PATH: process.env.PATH ?? "",
        Path: process.env.Path ?? "",
        OPENAI_API_KEY: "paid-fallback-key",
        AWS_SECRET_ACCESS_KEY: "aws-secret",
        GITHUB_TOKEN: "gh-token",
      },
      pacing: new CodexRateLimitBridge(burn, weights),
      checkpoints,
    });
    open.push({ records, cleanup: workspace.cleanup, adapter });
    const probed = await adapter.probe();
    expect(probed.status).toBe("ready");
    const handle = await adapter.startSession({
      attemptId: "attempt-stream",
      worktreeRoot: workspace.root,
      writeScope: ["src/**"],
      brief: "Implement the row formatter.",
      modelId: "gpt-5.1-codex",
      connection: siwc(),
      mcpEndpoint: "http://127.0.0.1:9/mcp/attempt-stream",
      skills: [{ name: "review", markdown: "Review the brief.\n" }],
    });
    open[0]!.sessionId = handle.sessionId;
    const config = readFileSync(path.join(handle.codexHome, "config.toml"), "utf8");
    expect(config).toContain('sandbox_mode = "workspace-write"');
    expect(config).toContain('sandbox = "mxc"');
    expect(config).toContain('approval_policy = "on-request"');
    expect(config).toContain("network_access = false");
    expect(config).toContain("http://127.0.0.1:9/mcp/attempt-stream");
    expect(config).not.toContain("siwc-access-1");
    expect(config).not.toContain("danger-full-access");
    expect(config).not.toContain("--yolo");
    expect(readFileSync(path.join(handle.codexHome, "skills", "review", "SKILL.md"), "utf8")).toContain("Review the brief.");
    expect(existsSync(path.join(handle.codexHome, "auth.json"))).toBe(false);
    expect(readFileSync(path.join(workspace.userHome, ".codex", "config.toml"), "utf8")).toBe("personal = true\n");
    expect(readFileSync(path.join(workspace.userHome, ".codex", "auth.json"), "utf8")).toBe("personal-auth\n");
    expect(handle.codexHome.includes(`${path.sep}.codex`)).toBe(false);
    const receipt = await adapter.sendTurn(handle.sessionId, "build the formatter");
    expect(receipt.stopReason).toBe("completed");
    expect(receipt.threadId).toBe("thread-1");
    const events = adapter.takeEvents(handle.sessionId).map((event) => event.type);
    expect(events).toContain("turn_started");
    expect(events).toContain("assistant_delta");
    expect(events).toContain("turn_completed");
    expect(events).toContain("usage_reported");
    expect(events).toContain("rate_limited");
    expect(adapter.takeEvents(handle.sessionId).some((event) => event.text === "hello")).toBe(true);
    expect(adapter.takeEvents(handle.sessionId).some((event) => event.text?.includes("siwc-access-1"))).toBe(false);
    const usage = await adapter.usage(handle.sessionId);
    expect(usage.currency).toBe("ppm");
    expect(usage.inputTokens).toBe(12);
    expect(usage.costMicroUsd).toBeUndefined();
    expect(adapter.authStatus()).toMatchObject({ kind: "sign_in_with_chatgpt", currency: "ppm", readsPersonalCodexHome: false });
    expect(checkpoints.read("attempt-stream")?.session_ref).toBe("thread-1");
    expect(records[0]?.args).toEqual([appServerScript]);
    expect(records[0]?.env.ACCESS_TOKEN).toBe("siwc-access-1");
    expect(records[0]?.env.OPENAI_API_KEY).toBeUndefined();
    expect(records[0]?.env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(records[0]?.env.GITHUB_TOKEN).toBeUndefined();
    expect(records[0]?.env.CODEX_HOME).toBe(handle.codexHome);
    expect(records[0]?.env.USERPROFILE).toBe(handle.codexHome);
    expect(JSON.stringify(records[0]?.args)).not.toContain("yolo");
    expect(JSON.stringify(records[0]?.args)).not.toContain("danger-full-access");
    expect(burn.observations.length).toBeGreaterThanOrEqual(2);
    await adapter.shutdown(handle.sessionId);
    const replay: string[] = [];
    for await (const event of adapter.events(handle.sessionId)) replay.push(event.type);
    expect(replay).toContain("assistant_delta");
  });

  it("approves an in-scope edit and declines git push in under 2 ms", async () => {
    const workspace = makeWorkspace();
    const records: SpawnRecord[] = [];
    const log = path.join(workspace.root, "approvals.log");
    const adapter = new CodexRuntimeAdapter({
      versionReader: async () => "1.2.3",
      spawner: recordingSpawn(records, (input) =>
        fakeEnv(input, {
          EF_FAKE_SCENARIO: "approvals",
          EF_FAKE_LOG: log,
          EF_FAKE_FILE_PATH: "src/ok.ts",
          EF_FAKE_COMMAND: "git push origin main",
        }),
      ),
      command: process.execPath,
      appServerArgs: [appServerScript],
      userHome: workspace.userHome,
      codexHomeRoot: workspace.codexHomeRoot,
    });
    open.push({ records, cleanup: workspace.cleanup, adapter });
    const handle = await adapter.startSession({
      attemptId: "attempt-approval",
      worktreeRoot: workspace.root,
      writeScope: ["src/**"],
      brief: "Edit only src.",
      modelId: "gpt-5.1-codex",
      connection: siwc(),
      mcpEndpoint: "http://127.0.0.1:9/mcp/attempt-approval",
    });
    open[0]!.sessionId = handle.sessionId;
    await adapter.sendTurn(handle.sessionId, "edit the file");
    const decisions = adapter.takeEvents(handle.sessionId).filter((event) => event.type === "permission_decided");
    const file = decisions.find((event) => event.path === "src/ok.ts");
    const command = decisions.find((event) => event.command === "git push origin main");
    expect(file?.decision).toBe("allow");
    expect(file?.elapsedMs).toBeLessThan(2);
    expect(command?.decision).toBe("deny");
    expect(command?.elapsedMs).toBeLessThan(2);
    await adapter.respondPermission(handle.sessionId, command?.requestId ?? "", "allow");
    const stillDenied = adapter
      .takeEvents(handle.sessionId)
      .filter((event) => event.requestId === command?.requestId && event.type === "permission_decided");
    expect(stillDenied.at(-1)?.decision).toBe("deny");
  });

  it("feeds 920000 ppm into pacing and refuses a silent paid switch at the wind-down ceiling", async () => {
    const workspace = makeWorkspace();
    const records: SpawnRecord[] = [];
    const percentFile = path.join(workspace.root, "percent.txt");
    writeFileSync(percentFile, "10\n");
    const burn = new LocalBurnRateWindowTracker();
    const weights = new LocalModelAllowanceWeightLearner();
    const adapter = new CodexRuntimeAdapter({
      versionReader: async () => "1.2.3",
      spawner: recordingSpawn(records, (input) =>
        fakeEnv(input, { EF_FAKE_SCENARIO: "stream", EF_FAKE_PERCENT_FILE: percentFile }),
      ),
      command: process.execPath,
      appServerArgs: [appServerScript],
      userHome: workspace.userHome,
      codexHomeRoot: workspace.codexHomeRoot,
      hostEnv: { PATH: process.env.PATH ?? "", OPENAI_API_KEY: "paid-fallback-key" },
      pacing: new CodexRateLimitBridge(burn, weights),
    });
    open.push({ records, cleanup: workspace.cleanup, adapter });
    const handle = await adapter.startSession({
      attemptId: "attempt-quota",
      worktreeRoot: workspace.root,
      writeScope: ["src/**"],
      brief: "Stay inside the allowance.",
      modelId: "gpt-5.1-codex",
      connection: siwc(),
      mcpEndpoint: "http://127.0.0.1:9/mcp/attempt-quota",
    });
    open[0]!.sessionId = handle.sessionId;
    expect(burn.observations[0]?.primaryPpm).toBe(100_000);
    expect(burn.observations[0]?.primaryResetAt).toBe("2026-11-23T16:00:00.000Z");
    const started = adapter.takeEvents(handle.sessionId).find((event) => event.type === "rate_limited");
    expect(started?.usedPpm).toBe(100_000);
    expect(started?.windDown).toBe(false);
    writeFileSync(percentFile, "92\n");
    await adapter.sendTurn(handle.sessionId, "continue");
    const latest = burn.observations.at(-1);
    expect(latest?.primaryPpm).toBe(920_000);
    expect(latest?.deltaPrimaryPpm).toBe(820_000);
    expect(latest?.phase).toBe("turn_completed");
    const limited = adapter.takeEvents(handle.sessionId).filter((event) => event.type === "rate_limited");
    expect(limited.at(-1)?.usedPpm).toBe(920_000);
    expect(limited.at(-1)?.windDown).toBe(true);
    expect(weights.observations.some((item) => item.modelId === "gpt-5.1-codex" && item.deltaPpm === 820_000)).toBe(true);
    await expect(adapter.sendTurn(handle.sessionId, "one more")).rejects.toMatchObject({ code: "allowance_wind_down" });
    expect(records.every((record) => record.env.OPENAI_API_KEY === undefined)).toBe(true);
    expect(records.every((record) => record.env.ACCESS_TOKEN === "siwc-access-1")).toBe(true);
    expect((await adapter.usage(handle.sessionId)).currency).toBe("ppm");
  });

  it("refreshes the access token at the turn boundary and resumes the same thread", async () => {
    const workspace = makeWorkspace();
    const records: SpawnRecord[] = [];
    const log = path.join(workspace.root, "refresh.log");
    const hold = path.join(workspace.root, "hold");
    const release = path.join(workspace.root, "release");
    let now = 0;
    let refreshes = 0;
    const adapter = new CodexRuntimeAdapter({
      versionReader: async () => "1.2.3",
      clock: () => now,
      tokenRefresher: {
        refresh: () => {
          refreshes += 1;
          return Promise.resolve({ accessToken: "refreshed-token", expiresAtMs: 9_000_000 });
        },
      },
      spawner: recordingSpawn(records, (input) =>
        fakeEnv(input, {
          EF_FAKE_SCENARIO: "hold",
          EF_FAKE_LOG: log,
          EF_FAKE_HOLD_PATH: hold,
          EF_FAKE_RELEASE_PATH: release,
        }),
      ),
      command: process.execPath,
      appServerArgs: [appServerScript],
      userHome: workspace.userHome,
      codexHomeRoot: workspace.codexHomeRoot,
    });
    open.push({ records, cleanup: workspace.cleanup, adapter });
    const handle = await adapter.startSession({
      attemptId: "attempt-refresh",
      worktreeRoot: workspace.root,
      writeScope: ["src/**"],
      brief: "Keep going past the hour.",
      modelId: "gpt-5.1-codex",
      connection: siwc(1_000_000),
      mcpEndpoint: "http://127.0.0.1:9/mcp/attempt-refresh",
    });
    open[0]!.sessionId = handle.sessionId;
    const pending = adapter.sendTurn(handle.sessionId, "long build");
    await waitFor(() => existsSync(hold));
    now = 900_000;
    writeFileSync(release, "go");
    const receipt = await pending;
    expect(receipt.stopReason).toBe("completed");
    expect(receipt.refreshed).toBe(true);
    expect(receipt.resumedThreadId).toBe("thread-1");
    expect(refreshes).toBe(1);
    expect(records).toHaveLength(2);
    expect(records[0]?.env.ACCESS_TOKEN).toBe("siwc-access-1");
    expect(records[1]?.env.ACCESS_TOKEN).toBe("refreshed-token");
    expect(records[1]?.env.OPENAI_API_KEY).toBeUndefined();
    expect(readLog(log)).toContain("thread/resume");
    expect(adapter.takeEvents(handle.sessionId).some((event) => event.type === "session_error")).toBe(false);
    expect(readFileSync(path.join(workspace.userHome, ".codex", "auth.json"), "utf8")).toBe("personal-auth\n");
    expect(isAlive(records[0]!.pid)).toBe(false);
  });

  it("falls back to codex-acp when app-server initialize fails and when policy forces it", async () => {
    const workspace = makeWorkspace();
    const records: SpawnRecord[] = [];
    const log = path.join(workspace.root, "fallback.log");
    const adapter = new CodexRuntimeAdapter({
      versionReader: async () => "1.2.3",
      spawner: recordingSpawn(records, (input) =>
        fakeEnv(input, { EF_FAKE_SCENARIO: "bad-init", ACP_SCENARIO: "approvals", EF_FAKE_LOG: log, EF_FAKE_COMMAND: "git push" }),
      ),
      command: process.execPath,
      appServerArgs: [appServerScript],
      acpCommand: process.execPath,
      acpArgs: [acpScript],
      userHome: workspace.userHome,
      codexHomeRoot: workspace.codexHomeRoot,
    });
    open.push({ records, cleanup: workspace.cleanup, adapter });
    const handle = await adapter.startSession({
      attemptId: "attempt-fallback",
      worktreeRoot: workspace.root,
      writeScope: ["src/**"],
      brief: "Use the fallback transport.",
      modelId: "gpt-5.1-codex",
      connection: siwc(),
      mcpEndpoint: "http://127.0.0.1:9/mcp/attempt-fallback",
      transport: "auto",
    });
    open[0]!.sessionId = handle.sessionId;
    expect(handle.transport).toBe("codex-acp");
    expect(records.map((record) => record.args[0])).toEqual([appServerScript, acpScript]);
    const receipt = await adapter.sendTurn(handle.sessionId, "fallback turn");
    expect(receipt.stopReason).toBe("completed");
    const types = adapter.takeEvents(handle.sessionId).map((event) => event.type);
    expect(types).toContain("assistant_delta");
    expect(types).toContain("turn_completed");
    expect(types).toContain("permission_decided");
    const decided = adapter
      .takeEvents(handle.sessionId)
      .filter((event) => event.type === "permission_decided")
      .map((event) => `${event.decision ?? ""}|${event.command ?? ""}|${event.path ?? ""}`);
    expect(decided).toContain("deny|git push|");
    expect(records.every((record) => !record.args.join(" ").includes("--yolo"))).toBe(true);
    expect(records.every((record) => !record.args.join(" ").includes("danger-full-access"))).toBe(true);

    const forcedRecords: SpawnRecord[] = [];
    const forced = new CodexRuntimeAdapter({
      versionReader: async () => "1.2.3",
      spawner: recordingSpawn(forcedRecords, (input) => fakeEnv(input, { EF_FAKE_SCENARIO: "stream" })),
      command: process.execPath,
      appServerArgs: [appServerScript],
      acpCommand: process.execPath,
      acpArgs: [acpScript],
      userHome: workspace.userHome,
      codexHomeRoot: workspace.codexHomeRoot,
      transportPreference: "codex-acp",
    });
    open.push({ records: forcedRecords, cleanup: () => undefined });
    const forcedHandle = await forced.startSession({
      attemptId: "attempt-forced-acp",
      worktreeRoot: workspace.root,
      writeScope: ["src/**"],
      brief: "ACP only.",
      modelId: "gpt-5.1-codex",
      connection: siwc(),
      mcpEndpoint: "http://127.0.0.1:9/mcp/forced",
    });
    open[1]!.adapter = forced;
    open[1]!.sessionId = forcedHandle.sessionId;
    expect(forcedRecords).toHaveLength(1);
    expect(forcedRecords[0]?.args).toEqual([acpScript]);
    expect(forcedHandle.transport).toBe("codex-acp");
  });

  it("reports version_too_old before launching and tags API-key sessions as micro-USD", async () => {
    const workspace = makeWorkspace();
    const records: SpawnRecord[] = [];
    const old = new CodexRuntimeAdapter({
      versionReader: async () => "0.1.0",
      minVersion: "0.42.0",
      spawner: recordingSpawn(records, () => ({})),
      command: process.execPath,
      appServerArgs: [appServerScript],
      userHome: workspace.userHome,
      codexHomeRoot: workspace.codexHomeRoot,
    });
    open.push({ records, cleanup: workspace.cleanup, adapter: old });
    const probe = await old.probe();
    expect(probe.status).toBe("version_too_old");
    expect(probe.requiredVersion).toBe("0.42.0");
    expect(probe.installedVersion).toBe("0.1.0");
    await expect(
      old.startSession({
        attemptId: "attempt-old",
        worktreeRoot: workspace.root,
        writeScope: ["src/**"],
        brief: "Do not start.",
        modelId: "gpt-5.1-codex",
        connection: siwc(),
        mcpEndpoint: "http://127.0.0.1:9/mcp/old",
      }),
    ).rejects.toMatchObject({ code: "version_too_old" });
    expect(records).toHaveLength(0);

    const missing = new CodexRuntimeAdapter({
      versionReader: async () => null,
      spawner: recordingSpawn(records, () => ({})),
      userHome: workspace.userHome,
      codexHomeRoot: workspace.codexHomeRoot,
    });
    await expect(missing.probe()).resolves.toMatchObject({ status: "missing", requiredVersion: "0.42.0" });

    const apiRecords: SpawnRecord[] = [];
    const api = new CodexRuntimeAdapter({
      versionReader: async () => "1.2.3",
      spawner: recordingSpawn(apiRecords, (input) => fakeEnv(input, { EF_FAKE_SCENARIO: "stream" })),
      command: process.execPath,
      appServerArgs: [appServerScript],
      userHome: workspace.userHome,
      codexHomeRoot: workspace.codexHomeRoot,
      hostEnv: { PATH: process.env.PATH ?? "", OPENAI_API_KEY: "paid-fallback-key" },
    });
    open.push({ records: apiRecords, cleanup: () => undefined, adapter: api });
    const handle = await api.startSession({
      attemptId: "attempt-api",
      worktreeRoot: workspace.root,
      writeScope: ["src/**"],
      brief: "Bill the API key.",
      modelId: "gpt-5.1-codex",
      connection: apiKeyConnection(),
      mcpEndpoint: "http://127.0.0.1:9/mcp/api",
    });
    open.at(-1)!.sessionId = handle.sessionId;
    expect(handle.currency).toBe("micro-USD");
    expect(apiRecords[0]?.env.OPENAI_API_KEY).toBe("api-key-1");
    expect(apiRecords[0]?.env.ACCESS_TOKEN).toBeUndefined();
    const usage = await api.usage(handle.sessionId);
    expect(usage.currency).toBe("micro-USD");
    expect(usage.quotaPpm).toBeUndefined();
    expect(api.authStatus().kind).toBe("openai_api_key");
  });

  it("reaps an unexpected exit, preserves WIP, and hands the thread to the resume coordinator", async () => {
    const workspace = makeWorkspace();
    const records: SpawnRecord[] = [];
    const childPid = path.join(workspace.root, "child.pid");
    const wip = new LocalWipSnapshot();
    const handoff = new LocalResumeHandoff();
    const fresh = new LocalLabeledWipRebuilder();
    const jobs = new LocalWindowsJob();
    const originalKill = jobs.kill.bind(jobs);
    jobs.kill = (jobId, reason) => {
      if (existsSync(childPid)) {
        const pid = Number(readFileSync(childPid, "utf8").trim());
        if (Number.isInteger(pid) && pid > 0) jobs.attach(jobId, pid);
      }
      return originalKill(jobId, reason);
    };
    const adapter = new CodexRuntimeAdapter({
      versionReader: async () => "1.2.3",
      spawner: recordingSpawn(records, (input) =>
        fakeEnv(input, { EF_FAKE_SCENARIO: "exit", EF_FAKE_CHILD_PID_FILE: childPid }),
      ),
      command: process.execPath,
      appServerArgs: [appServerScript],
      userHome: workspace.userHome,
      codexHomeRoot: workspace.codexHomeRoot,
      jobs,
      wip,
      resumeHandoff: handoff,
      freshSession: fresh,
    });
    open.push({ records, cleanup: workspace.cleanup, adapter, childPid });
    const handle = await adapter.startSession({
      attemptId: "attempt-crash",
      worktreeRoot: workspace.root,
      writeScope: ["src/**"],
      brief: "Survive a crash.",
      modelId: "gpt-5.1-codex",
      connection: siwc(),
      mcpEndpoint: "http://127.0.0.1:9/mcp/crash",
    });
    open[0]!.sessionId = handle.sessionId;
    const receipt = await adapter.sendTurn(handle.sessionId, "crash mid turn");
    expect(receipt.stopReason).toBe("failed");
    expect(receipt.exitCode).toBe(1);
    expect(wip.captures).toEqual([workspace.root]);
    expect(handoff.exits[0]).toMatchObject({ attemptId: "attempt-crash", threadId: "thread-1", exitCode: 1 });
    expect(fresh.rebuilds[0]?.reason).toBe("child_exit");
    expect(fresh.rebuilds[0]?.label).toBe(LABELED_WIP_HEADER);
    expect(jobs.list(handle.sessionId.replace("codex-", "job-"))).toEqual([]);
    await waitFor(() => existsSync(childPid));
    const child = Number(readFileSync(childPid, "utf8").trim());
    expect(isAlive(child)).toBe(false);
  });

  it("interrupts an unresponsive turn in under 500 ms", async () => {
    const workspace = makeWorkspace();
    const records: SpawnRecord[] = [];
    const log = path.join(workspace.root, "interrupt.log");
    const adapter = new CodexRuntimeAdapter({
      versionReader: async () => "1.2.3",
      spawner: recordingSpawn(records, (input) =>
        fakeEnv(input, { EF_FAKE_SCENARIO: "ignore-interrupt", EF_FAKE_LOG: log }),
      ),
      command: process.execPath,
      appServerArgs: [appServerScript],
      userHome: workspace.userHome,
      codexHomeRoot: workspace.codexHomeRoot,
    });
    open.push({ records, cleanup: workspace.cleanup, adapter });
    const handle = await adapter.startSession({
      attemptId: "attempt-interrupt",
      worktreeRoot: workspace.root,
      writeScope: ["src/**"],
      brief: "Stop cleanly.",
      modelId: "gpt-5.1-codex",
      connection: siwc(),
      mcpEndpoint: "http://127.0.0.1:9/mcp/interrupt",
    });
    open[0]!.sessionId = handle.sessionId;
    const pending = adapter.sendTurn(handle.sessionId, "hang");
    await waitFor(() => readLog(log).includes("turn/start"));
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
    const started = performance.now();
    await adapter.interrupt(handle.sessionId);
    const receipt = await pending;
    expect(performance.now() - started).toBeLessThan(500);
    expect(receipt.stopReason).toBe("interrupted");
  });

  it("uses thread/resume for additive steering and a labeled fresh session on contradiction or resume failure", async () => {
    const workspace = makeWorkspace();
    const records: SpawnRecord[] = [];
    const log = path.join(workspace.root, "steer.log");
    const fresh = new LocalLabeledWipRebuilder();
    const additive = new CodexRuntimeAdapter({
      versionReader: async () => "1.2.3",
      steering: new LocalSteeringDisposition("additive"),
      freshSession: fresh,
      spawner: recordingSpawn(records, (input) => fakeEnv(input, { EF_FAKE_SCENARIO: "stream", EF_FAKE_LOG: log })),
      command: process.execPath,
      appServerArgs: [appServerScript],
      userHome: workspace.userHome,
      codexHomeRoot: workspace.codexHomeRoot,
    });
    open.push({ records, cleanup: workspace.cleanup, adapter: additive });
    const handle = await additive.startSession({
      attemptId: "attempt-steer",
      worktreeRoot: workspace.root,
      writeScope: ["src/**"],
      brief: "Keep the contract.",
      modelId: "gpt-5.1-codex",
      connection: siwc(),
      mcpEndpoint: "http://127.0.0.1:9/mcp/steer",
    });
    open[0]!.sessionId = handle.sessionId;
    const steered = await additive.steer(handle.sessionId, "also handle an empty list");
    expect(steered.kind).toBe("turn");
    expect(readLog(log)).toContain("thread/resume");

    const contradictFresh = new LocalLabeledWipRebuilder();
    const contradictRecords: SpawnRecord[] = [];
    const contradictLog = path.join(workspace.root, "contradict.log");
    const contradict = new CodexRuntimeAdapter({
      versionReader: async () => "1.2.3",
      steering: new LocalSteeringDisposition("contradictory"),
      freshSession: contradictFresh,
      spawner: recordingSpawn(contradictRecords, (input) =>
        fakeEnv(input, { EF_FAKE_SCENARIO: "stream", EF_FAKE_LOG: contradictLog }),
      ),
      command: process.execPath,
      appServerArgs: [appServerScript],
      userHome: workspace.userHome,
      codexHomeRoot: workspace.codexHomeRoot,
    });
    open.push({ records: contradictRecords, cleanup: () => undefined, adapter: contradict });
    const contradictHandle = await contradict.startSession({
      attemptId: "attempt-contradict",
      worktreeRoot: workspace.root,
      writeScope: ["src/**"],
      brief: "Original brief.",
      modelId: "gpt-5.1-codex",
      connection: siwc(),
      mcpEndpoint: "http://127.0.0.1:9/mcp/contradict",
    });
    open.at(-1)!.sessionId = contradictHandle.sessionId;
    const freshSteer = await contradict.steer(contradictHandle.sessionId, "replace the data model");
    expect(freshSteer.kind).toBe("fresh");
    expect(freshSteer.label).toBe(LABELED_WIP_HEADER);
    expect(contradictFresh.rebuilds[0]?.reason).toBe("contradiction");
    expect(readLog(contradictLog)).not.toContain("thread/resume");

    const resumeFresh = new LocalLabeledWipRebuilder();
    const resumeRecords: SpawnRecord[] = [];
    const resumeAdapter = new CodexRuntimeAdapter({
      versionReader: async () => "1.2.3",
      freshSession: resumeFresh,
      spawner: recordingSpawn(resumeRecords, (input) => fakeEnv(input, { EF_FAKE_SCENARIO: "resume-fail" })),
      command: process.execPath,
      appServerArgs: [appServerScript],
      userHome: workspace.userHome,
      codexHomeRoot: workspace.codexHomeRoot,
    });
    open.push({ records: resumeRecords, cleanup: () => undefined, adapter: resumeAdapter });
    const resumeHandle = await resumeAdapter.startSession({
      attemptId: "attempt-resume",
      worktreeRoot: workspace.root,
      writeScope: ["src/**"],
      brief: "Resume later.",
      modelId: "gpt-5.1-codex",
      connection: siwc(),
      mcpEndpoint: "http://127.0.0.1:9/mcp/resume",
    });
    open.at(-1)!.sessionId = resumeHandle.sessionId;
    const resumed = await resumeAdapter.resume(resumeHandle.sessionId, { threadId: "thread-1" });
    expect(resumed.ok).toBe(false);
    expect(resumed.fallback).toBe("fresh");
    expect(resumed.label).toBe(LABELED_WIP_HEADER);
    expect(resumeFresh.rebuilds[0]?.reason).toBe("resume_failure");
  });

  it("refuses danger-full-access sandbox alignment before spawn", async () => {
    const workspace = makeWorkspace();
    const records: SpawnRecord[] = [];
    const sandbox = {
      align: () => ({
        sandboxMode: "danger-full-access",
        windowsMechanism: "elevated",
        writableRoots: [workspace.root],
        network: "open",
        proxy: "http://127.0.0.1:9",
      }),
    } as unknown as TierAMxcSandboxPort;
    const adapter = new CodexRuntimeAdapter({
      versionReader: async () => "1.2.3",
      sandbox,
      spawner: recordingSpawn(records, () => ({})),
      command: process.execPath,
      appServerArgs: [appServerScript, "--yolo"],
      userHome: workspace.userHome,
      codexHomeRoot: workspace.codexHomeRoot,
    });
    open.push({ records, cleanup: workspace.cleanup, adapter });
    await expect(
      adapter.startSession({
        attemptId: "attempt-danger",
        worktreeRoot: workspace.root,
        writeScope: ["src/**"],
        brief: "Do not elevate.",
        modelId: "gpt-5.1-codex",
        connection: siwc(),
        mcpEndpoint: "http://127.0.0.1:9/mcp/danger",
      }),
    ).rejects.toMatchObject({ code: "unrestricted_sandbox" });
    expect(records).toHaveLength(0);
  });
});
