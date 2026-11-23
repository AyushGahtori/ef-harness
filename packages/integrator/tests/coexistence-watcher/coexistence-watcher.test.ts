import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  ActiveScopeOverlapDetector,
  BaseSyncIntegrationMerger,
  EditorCoexistenceWatcher,
  ManualLockfileIncludeHandler,
  OVERLAP_CHOICES,
  createMinGitRepoInspector,
} from "../../src/coexistence-watcher/index.js";
import {
  InMemoryActiveTasks,
  InMemoryCoexistenceEventStore,
  InMemoryProjectMergeQueue,
  InMemoryTaskHoldsManager,
  NoopSmartBranchFreshnessSync,
  RecordingCoexistenceUi,
  RecordingHumanOwnedTransition,
  RecordingLandingOverlapFlag,
} from "../../src/coexistence-watcher/ports.js";
import { commitFile, createTempRepo, InMemoryRefLease, MockWatchBackend } from "./fixture.js";
import { HARNESS_INTEGRATION_REF } from "../../src/coexistence-watcher/constants.js";

describe("coexistence-watcher", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      if (fn) await fn();
    }
  });

  function buildPorts() {
    const tasks = new InMemoryActiveTasks();
    const holds = new InMemoryTaskHoldsManager();
    const ui = new RecordingCoexistenceUi();
    const events = new InMemoryCoexistenceEventStore();
    const mergeQueue = new InMemoryProjectMergeQueue();
    const freshness = new NoopSmartBranchFreshnessSync();
    const humanOwned = new RecordingHumanOwnedTransition();
    const landingFlags = new RecordingLandingOverlapFlag();
    return { tasks, holds, ui, events, mergeQueue, freshness, humanOwned, landingFlags };
  }

  it(
    "stays silent for edits outside active write scopes",
    async () => {
    const { root, cleanup } = await createTempRepo();
    cleanups.push(cleanup);
    const ports = buildPorts();
    ports.tasks.setTasks([
      {
        taskId: "A0014",
        agentLabel: "Worker A0014",
        state: "WORKING",
        writeScope: ["src/api/**"],
      },
    ]);
    const refs = new InMemoryRefLease();
    refs.seed(root, HARNESS_INTEGRATION_REF, spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim());
    const watcher = new EditorCoexistenceWatcher({
      checkoutRoot: root,
      devBranch: "main",
      ...ports,
      refs,
      debounceMs: 1,
    });
    await watcher.flushPath(path.join(root, "src", "marketing", "Hero.tsx"));
    await writeFile(path.join(root, "src", "marketing", "Hero.tsx"), "export const x = 1;\n", "utf8");
    await watcher.flushPath(path.join(root, "src", "marketing", "Hero.tsx"));
    expect(ports.holds.holds).toHaveLength(0);
    expect(ports.ui.overlapCards).toHaveLength(0);
    },
    30_000,
  );

  it(
    "places surgical hold and 3-choice overlap card on scope collision",
    async () => {
    const { root, cleanup } = await createTempRepo();
    cleanups.push(cleanup);
    const ports = buildPorts();
    ports.tasks.setTasks([
      { taskId: "A0014", agentLabel: "Worker A0014", state: "WORKING", writeScope: ["src/api/**"] },
      { taskId: "B0002", agentLabel: "Worker B0002", state: "WORKING", writeScope: ["src/db/**"] },
    ]);
    const refs = new InMemoryRefLease();
    const git = createMinGitRepoInspector();
    const integration = git.readRef(root, HARNESS_INTEGRATION_REF)!;
    refs.seed(root, HARNESS_INTEGRATION_REF, integration);
    const watcher = new EditorCoexistenceWatcher({
      checkoutRoot: root,
      devBranch: "main",
      ...ports,
      refs,
      debounceMs: 1,
      git,
    });
    await watcher.flushPath(path.join(root, "src", "api", "orders.ts"));
    expect(ports.holds.holds).toHaveLength(1);
    expect(ports.holds.holds[0]?.taskId).toBe("A0014");
    expect(ports.holds.holds[0]?.reason).toBe("editor_overlap");
    expect(ports.ui.overlapCards).toHaveLength(1);
    expect(ports.ui.overlapCards[0]?.choices).toEqual(OVERLAP_CHOICES);
    watcher.overlapDetector().resolveOverlap("src/api/orders.ts", "A0014", "keep_both");
    await watcher.flushPath(path.join(root, "src", "api", "orders.ts"));
    expect(ports.ui.overlapCards).toHaveLength(1);
    expect(ports.landingFlags.flags).toEqual([{ filePath: "src/api/orders.ts", taskId: "A0014" }]);
    },
    30_000,
  );

  it("detects lockfile edits without mutating git index", async () => {
    const { root, cleanup } = await createTempRepo();
    cleanups.push(cleanup);
    const ports = buildPorts();
    const refs = new InMemoryRefLease();
    const beforeStatus = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).stdout;
    const handler = new ManualLockfileIncludeHandler({ ui: ports.ui, events: ports.events });
    handler.noteFileEdit("package.json");
    handler.noteFileEdit("pnpm-lock.yaml");
    expect(ports.ui.lockfileCards).toHaveLength(1);
    const afterStatus = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).stdout;
    expect(afterStatus).toBe(beforeStatus);
    handler.recordDecision({ choice: "commit_and_include", files: ["package.json", "pnpm-lock.yaml"] });
    expect(ports.events.events.some((e) => e.kind === "lockfile_include")).toBe(true);
    refs.seed(root, HARNESS_INTEGRATION_REF, "abc");
  });

  it("merges developer commits into harness/integration and blocks rewrite", async () => {
    const { root, cleanup } = await createTempRepo();
    cleanups.push(cleanup);
    const ports = buildPorts();
    const refs = new InMemoryRefLease();
    const git = createMinGitRepoInspector();
    const initial = git.headSha(root)!;
    refs.seed(root, HARNESS_INTEGRATION_REF, initial);
    const merger = new BaseSyncIntegrationMerger({
      repoRoot: root,
      devBranch: "main",
      git,
      refs,
      mergeQueue: ports.mergeQueue,
      freshness: ports.freshness,
      tasks: ports.tasks,
      ui: ports.ui,
      events: ports.events,
    });
    merger.seedHead(initial);
    const next = await commitFile(root, "README.md", "# demo\n\nedit\n", "dev commit");
    const merged = await merger.onDevHeadMoved(initial, next);
    expect(merged.kind).toBe("merged");
    expect(ports.mergeQueue.requests).toHaveLength(1);
    expect(refs.readRef(root, HARNESS_INTEGRATION_REF)).toBe(next);
    spawnSync("git", ["commit", "--amend", "--no-edit"], { cwd: root, encoding: "utf8", windowsHide: true });
    const amended = git.headSha(root)!;
    const blocked = await merger.onDevHeadMoved(next, amended);
    expect(blocked.kind).toBe("rewrite_blocked");
    expect(ports.ui.rewriteCards).toHaveLength(1);
  }, 60_000);

  it(
    "releases watcher subscriptions on close",
    async () => {
    const { root, cleanup } = await createTempRepo();
    cleanups.push(cleanup);
    const ports = buildPorts();
    const refs = new InMemoryRefLease();
    refs.seed(root, HARNESS_INTEGRATION_REF, "deadbeef".padEnd(40, "0"));
    const backend = new MockWatchBackend();
    const watcher = new EditorCoexistenceWatcher({
      checkoutRoot: root,
      devBranch: "main",
      ...ports,
      refs,
      backend,
    });
    await watcher.start();
    expect(watcher.subscriptionCount()).toBe(2);
    expect(backend.liveCount()).toBe(2);
    await watcher.stop();
    expect(watcher.subscriptionCount()).toBe(0);
    expect(backend.liveCount()).toBe(0);
    const probe = path.join(root, "probe-delete-me");
    await writeFile(probe, "x", "utf8");
    await rm(probe);
    },
    30_000,
  );

  it("windows path overlap is case-insensitive", () => {
    const ports = buildPorts();
    ports.tasks.setTasks([
      { taskId: "A0014", agentLabel: "Worker", state: "WORKING", writeScope: ["src/API/**"] },
    ]);
    const detector = new ActiveScopeOverlapDetector({
      tasks: ports.tasks,
      holds: ports.holds,
      ui: ports.ui,
      events: ports.events,
      humanOwned: ports.humanOwned,
      landingFlags: ports.landingFlags,
    });
    const file = process.platform === "win32" ? "src/api/orders.ts" : "src/API/orders.ts";
    detector.detectOverlaps(file);
    expect(ports.holds.holds.length).toBeGreaterThan(0);
  });
});