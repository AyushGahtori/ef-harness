import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DiskLane } from "../../src/worktrees/disk-lane.js";
import {
  BeforeSlotResetRequiredError,
  SecretConfigCopyRejectedError,
  SlotOwnershipError,
  WorktreeSlotManager,
  readSlotOwnerMarker,
  rejectedConfigPath,
} from "../../src/worktrees/index.js";
import { createProcessGitRunner } from "../../src/worktrees/git-runner.js";
import {
  TEST_TIMEOUT_MS,
  cleanupFixture,
  commitAll,
  createFixture,
  gitOk,
  spyGit,
  stopBeforeReset,
  writeFiles,
  type Fixture,
} from "./helpers.js";

const PROJECT = "kitchen";

describe("worktree slot pool", () => {
  let fixture: Fixture | undefined;

  afterEach(async () => {
    if (fixture) await cleanupFixture(fixture);
    fixture = undefined;
  });

  it(
    "creates a short detached slot, fires the empty-slot hook first, and writes the ownership marker",
    async () => {
      fixture = await createFixture();
      const base = await seed(fixture, { "README.md": "hello\n" });
      let entriesDuringHook: string[] = ["not-yet"];
      let sawWorktreeAddDuringHook = true;
      const slots = new WorktreeSlotManager({
        wtRoot: fixture.wt,
        git: fixture.git,
        onEmptySlotCreated: async (slotPath) => {
          entriesDuringHook = await fs.readdir(slotPath);
          sawWorktreeAddDuringHook = fixture?.git.calls.some((call) => call[0] === "worktree" && call[1] === "add") ?? true;
        },
      });
      const handle = await slots.acquireSlot({
        projectId: PROJECT,
        mainRepoPath: fixture.main,
        baseCommit: base,
        taskId: "t038",
        attempt: 1,
      });
      expect(handle.projectShortId).toHaveLength(6);
      expect(handle.slotId).toHaveLength(6);
      expect(handle.headMode).toBe("detached");
      expect(handle.attemptBranchState).toBe("created");
      expect(handle.branch).toBe("harness/t/t038/1");
      expect(handle.reused).toBe(false);
      expect(path.resolve(handle.slotPath).toLowerCase().startsWith(path.resolve(fixture.wt).toLowerCase())).toBe(true);
      expect(entriesDuringHook).toEqual([]);
      expect(sawWorktreeAddDuringHook).toBe(false);
      expect(fixture.git.calls.some((call) => call[0] === "worktree" && call.includes("--detach"))).toBe(true);
      const marker = await readSlotOwnerMarker(handle.slotPath);
      expect(marker?.projectId).toBe(PROJECT);
      expect(marker?.kind).toBe("attempt");
      await expect(fs.readFile(path.join(handle.slotPath, "README.md"), "utf8")).resolves.toBe("hello\n");
      const symbolic = await fixture.git.execGit(["symbolic-ref", "-q", "HEAD"], { cwd: handle.slotPath });
      expect(symbolic.exitCode).not.toBe(0);
      const branchTip = await gitOk(fixture.git, fixture.main, ["rev-parse", "refs/heads/harness/t/t038/1"]);
      expect(branchTip).toBe(handle.headCommit);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "reuses a warm slot, preserves node_modules when the lockfile is unchanged, and wipes it when the lockfile changes",
    async () => {
      fixture = await createFixture();
      const syncs: string[] = [];
      const slots = new WorktreeSlotManager({
        wtRoot: fixture.wt,
        git: fixture.git,
        onDependencySyncRequested: (event) => {
          syncs.push(event.reason);
        },
      });
      const base = await seed(fixture, {
        "README.md": "v1\n",
        "pnpm-lock.yaml": "lock-v1\n",
        ".gitignore": "node_modules\n",
      });
      const first = await slots.acquireSlot({
        projectId: PROJECT,
        mainRepoPath: fixture.main,
        baseCommit: base,
        taskId: "t038",
        attempt: 1,
      });
      await fs.mkdir(path.join(first.slotPath, "node_modules", "pkg"), { recursive: true });
      await fs.writeFile(path.join(first.slotPath, "node_modules", "pkg", "index.js"), "warm");
      await fs.writeFile(path.join(first.slotPath, "build-out.txt"), "temp");
      await slots.releaseSlot({ projectId: PROJECT, mainRepoPath: fixture.main, slotId: first.slotId, outcome: "merged" });

      await writeFiles(fixture.main, { "README.md": "v2\n" });
      const sameLock = await commitAll(fixture.git, fixture.main, "docs");
      const reused = await slots.acquireSlot({
        projectId: PROJECT,
        mainRepoPath: fixture.main,
        baseCommit: sameLock,
        taskId: "t038",
        attempt: 2,
        beforeSlotReset: stopBeforeReset,
      });
      expect(reused.reused).toBe(true);
      expect(reused.slotPath).toBe(first.slotPath);
      expect(reused.nodeModulesPreserved).toBe(true);
      expect(reused.lockfileChanged).toBe(false);
      expect(reused.dependencySyncRequested).toBe(false);
      expect((await readSlotOwnerMarker(reused.slotPath))?.projectId).toBe(PROJECT);
      await expect(fs.readFile(path.join(reused.slotPath, "node_modules", "pkg", "index.js"), "utf8")).resolves.toBe("warm");
      await expect(fs.access(path.join(reused.slotPath, "build-out.txt"))).rejects.toMatchObject({ code: "ENOENT" });
      const clean = fixture.git.calls.filter((call) => call[0] === "clean").at(-1) ?? [];
      expect(clean).toContain("-fd");
      expect(clean).toContain(".ef-harness-slot-owner");
      expect(clean).toContain("node_modules");
      expect(clean).toContain(".pnpm-store");
      expect(clean).not.toContain("-x");
      expect(clean).not.toContain("-ff");
      expect(syncs).toEqual([]);

      await slots.releaseSlot({ projectId: PROJECT, mainRepoPath: fixture.main, slotId: reused.slotId, outcome: "merged" });
      await writeFiles(fixture.main, { "pnpm-lock.yaml": "lock-v2\n" });
      const changedLock = await commitAll(fixture.git, fixture.main, "lock");
      const wiped = await slots.acquireSlot({
        projectId: PROJECT,
        mainRepoPath: fixture.main,
        baseCommit: changedLock,
        taskId: "t038",
        attempt: 3,
        beforeSlotReset: stopBeforeReset,
      });
      expect(wiped.lockfileChanged).toBe(true);
      expect(wiped.nodeModulesPreserved).toBe(false);
      expect(wiped.dependencySyncRequested).toBe(true);
      expect(syncs).toEqual(["lockfile_changed"]);
      expect((await readSlotOwnerMarker(wiped.slotPath))?.projectId).toBe(PROJECT);
      expect((await readSlotOwnerMarker(wiped.slotPath))?.kind).toBe("attempt");
      await expect(fs.access(path.join(wiped.slotPath, "node_modules"))).rejects.toMatchObject({ code: "ENOENT" });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "requires beforeSlotReset and retries transient EBUSY before cleaning a slot",
    async () => {
      fixture = await createFixture();
      const base = await seed(fixture, { "README.md": "hello\n" });
      let cleans = 0;
      const delays: number[] = [];
      const git = spyGit(createProcessGitRunner(), async (args) => {
        if (args[0] !== "clean") return null;
        cleans += 1;
        if (cleans < 3) {
          return { exitCode: 1, stdout: "", stderr: "fatal: EBUSY resource busy", durationMs: 1 };
        }
        return null;
      });
      fixture = { ...fixture, git };
      const slots = new WorktreeSlotManager({
        wtRoot: fixture.wt,
        git,
        busyAttempts: 4,
        busyBaseDelayMs: 1,
        sleep: async (ms) => {
          delays.push(ms);
        },
      });
      const first = await slots.acquireSlot({
        projectId: PROJECT,
        mainRepoPath: fixture.main,
        baseCommit: base,
        taskId: "t038",
        attempt: 1,
      });
      await slots.releaseSlot({ projectId: PROJECT, mainRepoPath: fixture.main, slotId: first.slotId, outcome: "merged" });
      await expect(
        slots.acquireSlot({
          projectId: PROJECT,
          mainRepoPath: fixture.main,
          baseCommit: base,
          taskId: "t038",
          attempt: 2,
        }),
      ).rejects.toBeInstanceOf(BeforeSlotResetRequiredError);
      const reused = await slots.acquireSlot({
        projectId: PROJECT,
        mainRepoPath: fixture.main,
        baseCommit: base,
        taskId: "t038",
        attempt: 2,
        beforeSlotReset: stopBeforeReset,
      });
      expect(reused.reused).toBe(true);
      expect(cleans).toBeGreaterThanOrEqual(3);
      expect(delays).toEqual([1, 2]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "serializes cold worktree creation on the disk lane",
    async () => {
      fixture = await createFixture();
      const base = await seed(fixture, { "README.md": "hello\n" });
      let active = 0;
      let peak = 0;
      const git = spyGit(createProcessGitRunner(), async (args) => {
        if (args[0] === "worktree" && args[1] === "add") {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 200));
          active -= 1;
        }
        return null;
      });
      fixture = { ...fixture, git };
      const lane = new DiskLane();
      const slots = new WorktreeSlotManager({ wtRoot: fixture.wt, git, diskLane: lane });
      const [left, right] = await Promise.all([
        slots.acquireSlot({
          projectId: PROJECT,
          mainRepoPath: fixture.main,
          baseCommit: base,
          taskId: "t038",
          attempt: 1,
        }),
        slots.acquireSlot({
          projectId: PROJECT,
          mainRepoPath: fixture.main,
          baseCommit: base,
          taskId: "t039",
          attempt: 1,
        }),
      ]);
      expect(left.slotPath).not.toBe(right.slotPath);
      expect(peak).toBe(1);
      expect(lane.maxActive).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "stays detached when two slots would otherwise check out the same attempt branch",
    async () => {
      fixture = await createFixture();
      const base = await seed(fixture, { "README.md": "hello\n" });
      const slots = new WorktreeSlotManager({ wtRoot: fixture.wt, git: fixture.git });
      const first = await slots.acquireSlot({
        projectId: PROJECT,
        mainRepoPath: fixture.main,
        baseCommit: base,
        taskId: "t038",
        attempt: 7,
      });
      const second = await slots.acquireSlot({
        projectId: PROJECT,
        mainRepoPath: fixture.main,
        baseCommit: base,
        taskId: "t038",
        attempt: 7,
      });
      expect(first.attemptBranchState).toBe("created");
      expect(second.attemptBranchState).toBe("left-existing");
      for (const slotPath of [first.slotPath, second.slotPath]) {
        const symbolic = await fixture.git.execGit(["symbolic-ref", "-q", "HEAD"], { cwd: slotPath });
        expect(symbolic.exitCode).not.toBe(0);
      }
      const listed = await gitOk(fixture.git, fixture.main, ["worktree", "list", "--porcelain"]);
      const attemptLines = listed.split(/\r?\n/).filter((line) => line.includes("refs/heads/harness/t/t038/7"));
      expect(attemptLines).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refuses to delete a directory without a matching ownership marker",
    async () => {
      fixture = await createFixture();
      const base = await seed(fixture, { "README.md": "hello\n" });
      const slots = new WorktreeSlotManager({ wtRoot: fixture.wt, git: fixture.git });
      const handle = await slots.acquireSlot({
        projectId: PROJECT,
        mainRepoPath: fixture.main,
        baseCommit: base,
        taskId: "t038",
        attempt: 1,
      });
      const foreign = path.join(path.dirname(handle.slotPath), "foreign");
      await fs.mkdir(foreign, { recursive: true });
      await fs.writeFile(path.join(foreign, "keep.txt"), "keep");
      await expect(slots.removeOwnedSlot(PROJECT, fixture.main, foreign)).rejects.toBeInstanceOf(SlotOwnershipError);
      await expect(fs.readFile(path.join(foreign, "keep.txt"), "utf8")).resolves.toBe("keep");
      await slots.pruneStaleWorktrees({ projectId: PROJECT, mainRepoPath: fixture.main });
      await expect(fs.readFile(path.join(foreign, "keep.txt"), "utf8")).resolves.toBe("keep");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "copies allowlisted config and refuses env files, keys, and vault names",
    async () => {
      fixture = await createFixture();
      await writeFiles(fixture.main, {
        "README.md": "hello\n",
        ".gitignore": "config/local.json\n.env\ncerts/\n",
      });
      const base = await commitAll(fixture.git, fixture.main, "init");
      await writeFiles(fixture.main, {
        "config/local.json": "{\"ok\":true}\n",
        ".env": "SECRET=1\n",
        "certs/server.pem": "pem\n",
      });
      const slots = new WorktreeSlotManager({ wtRoot: fixture.wt, git: fixture.git });
      await expect(
        slots.acquireSlot({
          projectId: PROJECT,
          mainRepoPath: fixture.main,
          baseCommit: base,
          taskId: "t038",
          attempt: 1,
          environmentManifest: { allowlistedConfigFiles: [".env"], vaultNames: [] },
        }),
      ).rejects.toBeInstanceOf(SecretConfigCopyRejectedError);
      await expect(
        slots.acquireSlot({
          projectId: PROJECT,
          mainRepoPath: fixture.main,
          baseCommit: base,
          taskId: "t038",
          attempt: 1,
          environmentManifest: { allowlistedConfigFiles: ["certs/server.pem"] },
        }),
      ).rejects.toBeInstanceOf(SecretConfigCopyRejectedError);
      await expect(
        slots.acquireSlot({
          projectId: PROJECT,
          mainRepoPath: fixture.main,
          baseCommit: base,
          taskId: "t038",
          attempt: 1,
          environmentManifest: { allowlistedConfigFiles: ["config/local.json"], vaultNames: ["local.json"] },
        }),
      ).rejects.toBeInstanceOf(SecretConfigCopyRejectedError);
      const handle = await slots.acquireSlot({
        projectId: PROJECT,
        mainRepoPath: fixture.main,
        baseCommit: base,
        taskId: "t038",
        attempt: 1,
        environmentManifest: { allowlistedConfigFiles: ["config/local.json"], vaultNames: ["vault-item"] },
      });
      await expect(fs.readFile(path.join(handle.slotPath, "config", "local.json"), "utf8")).resolves.toBe("{\"ok\":true}\n");
      await expect(fs.access(path.join(handle.slotPath, ".env"))).rejects.toMatchObject({ code: "ENOENT" });
      expect(rejectedConfigPath(".env.local", [])?.reason).toBe("env_file");
      expect(rejectedConfigPath("id_rsa.key", [])?.reason).toBe("key");
      expect(rejectedConfigPath("../secret.json", [])?.reason).toBe("path_traversal");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "recommends sparse checkout and lowers parallelism when worktree add exceeds the threshold",
    async () => {
      fixture = await createFixture();
      const base = await seed(fixture, { "README.md": "hello\n" });
      const slow = new WorktreeSlotManager({
        wtRoot: fixture.wt,
        git: fixture.git,
        slowWorktreeThresholdMs: -1,
        defaultRecommendedParallelism: 4,
      });
      const slowHandle = await slow.acquireSlot({
        projectId: PROJECT,
        mainRepoPath: fixture.main,
        baseCommit: base,
        taskId: "t038",
        attempt: 1,
      });
      expect(slowHandle.recommendSparseCheckout).toBe(true);
      expect(slowHandle.recommendedParallelism).toBe(2);
      expect(slowHandle.worktreeAddDurationMs).toBeGreaterThan(-1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "keeps a failed slot for inspection for 24 hours, then recycles it",
    async () => {
      fixture = await createFixture();
      const base = await seed(fixture, { "README.md": "hello\n" });
      let now = 1_700_000_000_000;
      const slots = new WorktreeSlotManager({
        wtRoot: fixture.wt,
        git: fixture.git,
        clock: () => now,
        failedSlotRetentionMs: 24 * 60 * 60 * 1000,
      });
      const failed = await slots.acquireSlot({
        projectId: PROJECT,
        mainRepoPath: fixture.main,
        baseCommit: base,
        taskId: "t038",
        attempt: 1,
      });
      await fs.writeFile(path.join(failed.slotPath, "inspection.txt"), "keep");
      await slots.releaseSlot({ projectId: PROJECT, mainRepoPath: fixture.main, slotId: failed.slotId, outcome: "failed" });
      const duringRetention = await slots.acquireSlot({
        projectId: PROJECT,
        mainRepoPath: fixture.main,
        baseCommit: base,
        taskId: "t038",
        attempt: 2,
      });
      expect(duringRetention.slotPath).not.toBe(failed.slotPath);
      await expect(fs.readFile(path.join(failed.slotPath, "inspection.txt"), "utf8")).resolves.toBe("keep");
      now += 24 * 60 * 60 * 1000;
      const pruned = await slots.pruneStaleWorktrees({ projectId: PROJECT, mainRepoPath: fixture.main });
      expect(pruned.recycledSlotIds).toContain(failed.slotId);
      await slots.releaseSlot({ projectId: PROJECT, mainRepoPath: fixture.main, slotId: duringRetention.slotId, outcome: "merged" });
      const recycled = await slots.acquireSlot({
        projectId: PROJECT,
        mainRepoPath: fixture.main,
        baseCommit: base,
        taskId: "t038",
        attempt: 3,
        beforeSlotReset: stopBeforeReset,
      });
      expect([failed.slotPath, duringRetention.slotPath]).toContain(recycled.slotPath);
      expect(recycled.reused).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );
});

async function seed(fixture: Fixture, files: Readonly<Record<string, string>>): Promise<string> {
  await writeFiles(fixture.main, files);
  return commitAll(fixture.git, fixture.main, "init");
}
