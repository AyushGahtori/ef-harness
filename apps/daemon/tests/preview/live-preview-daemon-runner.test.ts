import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createLivePreviewDaemonRunner } from "../../src/preview/create-runner.js";
import { LiveKeyRefusedError } from "../../src/preview/errors.js";
import { cliFixtureFiles, webFixtureFiles } from "../../src/preview/fixture-files.js";
import { pidAlive, LocalWindowsJobSupervisor } from "../../src/preview/local-job-supervisor.js";
import { LocalPortLeaseRepo } from "../../src/preview/local-port-lease.js";
import type { LivePreviewDaemonRunner } from "../../src/preview/live-preview-daemon-runner.js";
import type { PreviewSecret, SqlMigration } from "../../src/preview/ports.js";
import { lastGoodBanner } from "../../src/preview/preview-partition.js";
import { ManualPreviewScheduler } from "../../src/preview/scheduler.js";
import {
  CRASH_DETECT_MS,
  DEFAULT_PREVIEW_TIMINGS,
  HEALTH_PROBE_FAIL_MS,
  HEALTHY_BOOT_WINDOW_MS,
  HIDDEN_SUSPEND_MS,
  PREVIEW_PORT_MAX,
  PREVIEW_PORT_MIN,
  RESET_DEMO_BUDGET_MS,
} from "../../src/preview/timings.js";

const cleanups: Array<() => Promise<void>> = [];

beforeAll(() => {
  process.env.EF_PREVIEW_PORT_BASE = "41000";
});

function testStripeKey(): string {
  return ["sk", "_test_", "canaryvalue"].join("");
}

function liveStripeKey(): string {
  return ["sk", "_live_", "canaryvalue"].join("");
}

function secrets(stripe: string, scope: PreviewSecret["scope"] = "test"): PreviewSecret[] {
  return [
    { name: "STRIPE_TEST_KEY", value: stripe, scope, kind: "stripe" },
    { name: "SMTP_URL", value: "smtp://127.0.0.1:2525", scope: "dev", kind: "smtp" },
    { name: "S3_ENDPOINT", value: "http://127.0.0.1:9000", scope: "dev", kind: "s3" },
    { name: "OAUTH_ISSUER", value: "http://127.0.0.1:9/oauth", scope: "test", kind: "oauth" },
  ];
}

function cateringMigration(): SqlMigration {
  return {
    id: "m-catering-email",
    featureId: "F-CateringEmail",
    sql: "ALTER TABLE orders ADD COLUMN catering_email TEXT",
  };
}

async function removeDir(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  }
}

function harness(input?: {
  readonly projectId?: string;
  readonly engine?: "sqlite" | "postgres";
  readonly kind?: "web" | "cli";
  readonly secrets?: readonly PreviewSecret[];
  readonly scheduler?: ManualPreviewScheduler;
  readonly timings?: Partial<import("../../src/preview/timings.js").PreviewTimings>;
  readonly ports?: LocalPortLeaseRepo;
  readonly jobs?: LocalWindowsJobSupervisor;
  readonly commits?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly headSha?: string;
}): { runner: LivePreviewDaemonRunner; jobs: LocalWindowsJobSupervisor; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-preview-run-"));
  const projectId = input?.projectId ?? "cafe";
  const developer = path.join(dir, "developer-checkout");
  const worker = path.join(dir, "wt", projectId, "slot-1");
  fs.mkdirSync(developer, { recursive: true });
  fs.mkdirSync(worker, { recursive: true });
  fs.writeFileSync(path.join(developer, "MARKER.txt"), "developer-desk\n");
  fs.writeFileSync(path.join(worker, "MARKER.txt"), "worker-slot\n");
  const kind = input?.kind ?? "web";
  const jobs = input?.jobs ?? new LocalWindowsJobSupervisor();
  const commits =
    input?.commits ??
    (kind === "cli"
      ? { abc123: cliFixtureFiles() }
      : {
          abc123: webFixtureFiles("serve"),
          wave2: webFixtureFiles("serve"),
          bad999: webFixtureFiles("crash"),
          hang111: webFixtureFiles("hang"),
          port222: webFixtureFiles("ignore-port"),
        });
  const runner = createLivePreviewDaemonRunner({
    projectId,
    dataDir: path.join(dir, "data"),
    wtRoot: path.join(dir, "wt"),
    developerCheckoutPath: developer,
    workerSlotPath: worker,
    commits,
    headSha: input?.headSha ?? "abc123",
    target:
      kind === "cli"
        ? { kind: "cli", command: process.execPath, args: ["expense-cli.mjs"] }
        : { kind: "web", command: process.execPath, args: ["preview-dev-server.mjs"] },
    secrets: input?.secrets ?? secrets(testStripeKey()),
    engine: input?.engine,
    scheduler: input?.scheduler,
    timings: { healthyBootWindowMs: 30_000, ...input?.timings },
    ports: input?.ports,
    jobs,
  });
  cleanups.push(async () => {
    await runner.quitHarness();
    await removeDir(dir);
  });
  return { runner, jobs, dir };
}

async function postOrder(origin: string, id: string, note: string): Promise<void> {
  const response = await fetch(`${origin}/orders`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, note }),
  });
  expect(response.status).toBe(201);
}

afterEach(async () => {
  const pending = cleanups.splice(0);
  for (const cleanup of pending) await cleanup();
});

describe("LivePreviewDaemonRunner", { timeout: 60_000 }, () => {
  it("publishes the preview timing and port-range contract", () => {
    expect(PREVIEW_PORT_MIN).toBe(41_000);
    expect(PREVIEW_PORT_MAX).toBe(48_999);
    expect(DEFAULT_PREVIEW_TIMINGS).toEqual({
      healthyBootWindowMs: HEALTHY_BOOT_WINDOW_MS,
      healthProbeFailMs: HEALTH_PROBE_FAIL_MS,
      crashDetectMs: CRASH_DETECT_MS,
      hiddenSuspendMs: HIDDEN_SUSPEND_MS,
      resetDemoBudgetMs: RESET_DEMO_BUDGET_MS,
    });
    expect(HEALTHY_BOOT_WINDOW_MS).toBe(5_000);
    expect(HEALTH_PROBE_FAIL_MS).toBe(20_000);
    expect(CRASH_DETECT_MS).toBe(10_000);
    expect(HIDDEN_SUSPEND_MS).toBe(15 * 60 * 1000);
  });

  it("boots lazily from wt/<project>/integration on a leased loopback port and tears down with zero leaks", async () => {
    process.env.PARENT_CANARY = "parent-canary";
    try {
    const { runner, jobs } = harness();
    expect(runner.noteHeadlessElapsed(20 * 60 * 1000)).toEqual({
      ramBytes: 0,
      cpuPercent: 0,
      serverProcesses: 0,
      elapsedMs: 20 * 60 * 1000,
    });
    expect(runner.snapshot().everStarted).toBe(false);
    expect(jobs.activePids()).toEqual([]);
    const opened = await runner.openPreview({ reason: "tab", path: "/orders" });
    expect(opened.state).toBe("running");
    expect(opened.openedBy).toBe("tab");
    expect(opened.port).toBeGreaterThanOrEqual(PREVIEW_PORT_MIN);
    expect(opened.port).toBeLessThanOrEqual(PREVIEW_PORT_MAX);
    expect(opened.path).toBe("/orders");
    expect(opened.worktreePath?.endsWith(`${path.sep}cafe${path.sep}integration`)).toBe(true);
    expect(opened.pid).not.toBeNull();
    expect(jobs.spawnContainedSecret(testStripeKey())).toBe(false);
    expect(jobs.lastCwd()?.endsWith(`${path.sep}integration`)).toBe(true);
    expect(jobs.lastArgs().join(" ")).not.toContain(testStripeKey());
    const origin = opened.origin ?? "";
    const marker = (await (await fetch(`${origin}/cwd-marker`)).json()) as { marker: string; cwd: string };
    expect(marker.marker).toBe("integration-head");
    expect(marker.cwd.endsWith(`${path.sep}integration`)).toBe(true);
    expect(marker.cwd).not.toContain("developer-checkout");
    expect(marker.cwd).not.toContain("slot-1");
    const flags = (await (await fetch(`${origin}/env-flags`)).json()) as {
      stripeTest: boolean;
      parentCanary: boolean;
      smtp: boolean;
      s3: boolean;
      oauth: boolean;
    };
    expect(flags).toEqual({ stripeTest: true, parentCanary: false, smtp: true, s3: true, oauth: true });
    expect((await fetch(`${origin}/@vite/client`)).status).toBe(200);
    const report = await runner.closeProject();
    expect(report.leakedPids).toEqual([]);
    expect(report.leasedPorts).toBe(0);
    if (opened.pid !== null) expect(pidAlive(opened.pid)).toBe(false);
    } finally {
      delete process.env.PARENT_CANARY;
    }
  });

  it("preserves three demo orders across an additive merge and resets only on Reset Demo Data", async () => {
    const { runner } = harness();
    const opened = await runner.openPreview({ path: "/orders" });
    const origin = opened.origin ?? "";
    await postOrder(origin, "o1", "soup");
    await postOrder(origin, "o2", "salad");
    await postOrder(origin, "o3", "tea");
    const previous = opened.pid;
    const refresh = await runner.onPreviewReload({
      kind: "preview-reload",
      featureIds: ["F-CateringEmail"],
      integrationSha: "wave2",
      restartPreview: true,
      schemaChanged: true,
      migrations: [cateringMigration()],
    });
    expect(refresh.mode).toBe("restart");
    expect(refresh.pill).toBe("Updated to include Feature F-CateringEmail");
    expect(refresh.path).toBe("/orders");
    expect(refresh.pid).not.toBe(previous);
    const snap = runner.snapshot();
    const rows = (await (await fetch(`${snap.origin}/orders`)).json()) as Array<{ id: string; note: string; catering_email: string | null }>;
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.note)).toEqual(["soup", "salad", "tea"]);
    expect(rows.every((row) => row.catering_email === null)).toBe(true);
    const reset = await runner.resetDemoData();
    expect(reset.reloaded).toBe(true);
    expect(reset.elapsedMs).toBeLessThan(RESET_DEMO_BUDGET_MS);
    const after = runner.snapshot();
    expect(await (await fetch(`${after.origin}/orders`)).json()).toEqual([]);
    const meta = (await (await fetch(`${after.origin}/meta`)).json()) as Array<{ key: string; value: string }>;
    expect(meta).toContainEqual({ key: "seed", value: "functional" });
  });

  it("hot-reloads when schema and config are unchanged", async () => {
    const { runner } = harness();
    const opened = await runner.openPreview();
    await postOrder(opened.origin ?? "", "o1", "soup");
    const refresh = await runner.onPreviewReload({
      kind: "preview-reload",
      featureIds: ["F-CateringEmail"],
      integrationSha: "wave2",
      restartPreview: true,
      schemaChanged: false,
      configChanged: false,
    });
    expect(refresh.mode).toBe("hmr");
    expect(refresh.pid).toBe(opened.pid);
    expect(refresh.pill).toBe("Updated to include Feature F-CateringEmail");
    const rows = (await (await fetch(`${opened.origin}/orders`)).json()) as unknown[];
    expect(rows).toHaveLength(1);
  });

  it("falls back to the last good commit when the new boot crashes", async () => {
    const { runner } = harness();
    const opened = await runner.openPreview();
    await postOrder(opened.origin ?? "", "o1", "soup");
    await postOrder(opened.origin ?? "", "o2", "salad");
    await postOrder(opened.origin ?? "", "o3", "tea");
    const started = Date.now();
    const refresh = await runner.onPreviewReload({
      kind: "preview-reload",
      featureIds: ["F-BrokenEnv"],
      integrationSha: "bad999",
      restartPreview: true,
      configChanged: true,
    });
    expect(Date.now() - started).toBeLessThan(CRASH_DETECT_MS);
    expect(refresh.mode).toBe("fallback");
    expect(refresh.banner).toBe(lastGoodBanner("abc123"));
    expect(refresh.state).toBe("running");
    const snap = runner.snapshot();
    expect(snap.stderrRedacted).toContain("[REDACTED_SECRET:STRIPE_TEST_KEY]");
    expect(snap.stderrRedacted).not.toContain(testStripeKey());
    expect(runner.sendErrorToFix()).toMatchObject({
      task: 161,
      type: "send-error-to-fix",
      commitSha: "bad999",
      stderrRedacted: snap.stderrRedacted,
    });
    const rows = (await (await fetch(`${snap.origin}/orders`)).json()) as unknown[];
    expect(rows).toHaveLength(3);
    expect((await fetch(`${snap.origin}/`)).status).toBe(200);
  });

  it("falls back when a hung boot misses the health probe", async () => {
    const { runner } = harness({ timings: { healthProbeFailMs: 400 } });
    await runner.openPreview();
    const started = Date.now();
    const refresh = await runner.onPreviewReload({
      kind: "preview-reload",
      featureIds: ["F-Hang"],
      integrationSha: "hang111",
      restartPreview: true,
      configChanged: true,
    });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(400);
    expect(elapsed).toBeLessThan(CRASH_DETECT_MS);
    expect({
      mode: refresh.mode,
      state: refresh.state,
      banner: refresh.banner,
      sha: refresh.commitSha,
      pid: refresh.pid,
      snap: runner.snapshot().state,
    }).toEqual({
      mode: "fallback",
      state: "running",
      banner: lastGoodBanner("abc123"),
      sha: "abc123",
      pid: expect.any(Number),
      snap: "running",
    });
  }, 60_000);

  it("kills a server that ignores PORT and does not leave a leaked pid", async () => {
    const { runner } = harness({
      timings: { healthProbeFailMs: 350 },
      headSha: "port222",
      commits: { port222: webFixtureFiles("ignore-port") },
    });
    const opened = await runner.openPreview();
    expect(opened.state).toBe("failed");
    expect(opened.banner).toContain("No last working build");
    expect(opened.pid).toBeNull();
    expect(opened.leakedPids).toEqual([]);
    expect(runner.snapshot().serverProcesses).toBe(0);
  });

  it("refuses a live key before any preview process starts", async () => {
    const jobs = new LocalWindowsJobSupervisor();
    const { runner } = harness({ jobs, secrets: secrets(liveStripeKey(), "test") });
    await expect(runner.openPreview()).rejects.toBeInstanceOf(LiveKeyRefusedError);
    expect(runner.snapshot().everStarted).toBe(false);
    expect(jobs.activePids()).toEqual([]);
    expect(jobs.leakedPids()).toEqual([]);
    const remote = harness({
      secrets: [{ name: "SMTP_URL", value: "smtp://mail.example.com:25", scope: "dev", kind: "smtp" }],
    });
    await expect(remote.runner.openPreview()).rejects.toBeInstanceOf(LiveKeyRefusedError);
  });

  it("suspends after 15 hidden minutes or immediately on governor RED, then wakes", async () => {
    const scheduler = new ManualPreviewScheduler();
    const { runner } = harness({ scheduler });
    const opened = await runner.openPreview();
    const pid = opened.pid;
    runner.markHidden();
    await scheduler.advance(HIDDEN_SUSPEND_MS - 1);
    expect(runner.snapshot().state).toBe("running");
    expect(pid !== null && pidAlive(pid)).toBe(true);
    await scheduler.advance(1);
    expect(runner.snapshot().state).toBe("suspended");
    expect(pid !== null && pidAlive(pid)).toBe(false);
    expect(runner.snapshot().ramBytes).toBe(0);
    const woken = await runner.wake();
    expect(woken.state).toBe("running");
    expect(woken.pid).not.toBeNull();
    await runner.applyPressure("RED");
    expect(runner.snapshot().state).toBe("suspended");
    expect(scheduler.nowMs).toBe(HIDDEN_SUSPEND_MS);
    const shownScheduler = new ManualPreviewScheduler();
    const shown = harness({ scheduler: shownScheduler });
    await shown.runner.openPreview();
    shown.runner.markHidden();
    shown.runner.markShown();
    await shownScheduler.advance(HIDDEN_SUSPEND_MS);
    expect(shown.runner.snapshot().state).toBe("running");
  }, 30_000);

  it("runs an interactive CLI preview against the persistent demo workspace", async () => {
    const { runner } = harness({ kind: "cli" });
    const opened = await runner.openPreview({ reason: "pop-out" });
    expect(opened.mode).toBe("cli");
    expect(opened.openedBy).toBe("pop-out");
    expect(opened.port).toBeNull();
    expect(opened.serverProcesses).toBe(0);
    expect((await runner.runCli(["add", "o1", "noodles"])).stdout.trim()).toBe("added");
    expect(await runner.runCli(["add", "o2", "rice"])).toMatchObject({ exitCode: 0 });
    const listed = await runner.runCli(["list"]);
    expect(JSON.parse(listed.stdout)).toEqual([
      { id: "o1", note: "noodles" },
      { id: "o2", note: "rice" },
    ]);
    const cwd = (await runner.runCli(["cwd"])).stdout.trim();
    expect(cwd.endsWith(`${path.sep}integration`)).toBe(true);
    expect((await runner.runCli(["env-has", "STRIPE_TEST_KEY"])).stdout.trim()).toBe("yes");
    expect((await runner.runCli(["env-has", "PARENT_CANARY"])).stdout.trim()).toBe("no");
    await runner.resetDemoData();
    expect(JSON.parse((await runner.runCli(["list"])).stdout)).toEqual([]);
    const report = await runner.quitHarness();
    expect(report.reason).toBe("quit");
    expect(report.leakedPids).toEqual([]);
    expect(report.leasedPorts).toBe(0);
  });

  it("leases distinct preview ports for two projects and releases both on quit", async () => {
    const ports = new LocalPortLeaseRepo();
    const first = harness({ projectId: "cafe", ports });
    const second = harness({ projectId: "diner", ports });
    const a = await first.runner.openPreview();
    const b = await second.runner.openPreview();
    expect(a.port).not.toBe(b.port);
    expect(a.port).toBeGreaterThanOrEqual(PREVIEW_PORT_MIN);
    expect(b.port).toBeLessThanOrEqual(PREVIEW_PORT_MAX);
    expect((await fetch(`${a.origin}/`)).status).toBe(200);
    expect((await fetch(`${b.origin}/`)).status).toBe(200);
    expect((await first.runner.quitHarness()).leasedPorts).toBe(0);
    expect((await second.runner.quitHarness()).leakedPids).toEqual([]);
    expect(ports.list()).toEqual([]);
  });

  it("spends no preview process while Preview stays closed", async () => {
    const jobs = new LocalWindowsJobSupervisor();
    const { runner } = harness({ jobs });
    expect(runner.noteHeadlessElapsed(20 * 60 * 1000).serverProcesses).toBe(0);
    expect(jobs.leakedPids()).toEqual([]);
    expect(runner.snapshot().ramBytes).toBe(0);
    expect(runner.snapshot().cpuPercent).toBe(0);
  });

  it("rejects a destructive migration without stopping the healthy preview", async () => {
    const { runner } = harness();
    const opened = await runner.openPreview();
    await postOrder(opened.origin ?? "", "o1", "soup");
    await expect(
      runner.onPreviewReload({
        kind: "preview-reload",
        featureIds: ["F-Wipe"],
        integrationSha: "wave2",
        restartPreview: true,
        schemaChanged: true,
        migrations: [{ id: "m-drop", featureId: "F-Wipe", sql: "DELETE FROM orders" }],
      }),
    ).rejects.toThrow(/additive/);
    expect(runner.snapshot().state).toBe("running");
    expect(runner.snapshot().pid).toBe(opened.pid);
    const rows = (await (await fetch(`${opened.origin}/orders`)).json()) as unknown[];
    expect(rows).toHaveLength(1);
  });
});
