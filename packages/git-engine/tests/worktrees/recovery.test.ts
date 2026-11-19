import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorktreeSlotManager } from "../../src/worktrees/index.js";
import {
  TEST_TIMEOUT_MS,
  cleanupFixture,
  commitAll,
  createFixture,
  gitOk,
  writeFiles,
  type Fixture,
} from "./helpers.js";

const PROJECT = "kitchen";

describe("worktree recovery", () => {
  let fixture: Fixture | undefined;
  const extraRepos: string[] = [];

  afterEach(async () => {
    if (fixture) await cleanupFixture(fixture, extraRepos);
    extraRepos.length = 0;
    fixture = undefined;
  });

  it(
    "recreates a manually deleted slot from the latest checkpoint ref without throwing ENOENT",
    async () => {
      fixture = await createFixture();
      await writeFiles(fixture.main, { "README.md": "base\n" });
      const base = await commitAll(fixture.git, fixture.main, "base");
      const slots = new WorktreeSlotManager({ wtRoot: fixture.wt, git: fixture.git });
      const handle = await slots.acquireSlot({
        projectId: PROJECT,
        mainRepoPath: fixture.main,
        baseCommit: base,
        taskId: "t038",
        attempt: 1,
      });
      await writeFiles(fixture.main, { "checkpoint.txt": "restored\n" });
      const checkpoint = await commitAll(fixture.git, fixture.main, "checkpoint");
      await gitOk(fixture.git, fixture.main, ["update-ref", "refs/harness/checkpoints/t038/1", checkpoint]);
      await fs.rm(handle.slotPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      const report = await slots.reconcileMissingWorktrees({ projectId: PROJECT, mainRepoPath: fixture.main });
      expect(report.recovered).toHaveLength(1);
      expect(report.recovered[0]?.action).toBe("fence_and_recreate");
      expect(report.recovered[0]?.checkpointRef).toBe("refs/harness/checkpoints/t038/1");
      expect(report.recovered[0]?.checkpointSha).toBe(checkpoint);
      await expect(fs.readFile(path.join(handle.slotPath, "checkpoint.txt"), "utf8")).resolves.toBe("restored\n");
      const head = await gitOk(fixture.git, handle.slotPath, ["rev-parse", "HEAD"]);
      expect(head).toBe(checkpoint);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "repairs worktree links after the main repository is moved",
    async () => {
      fixture = await createFixture();
      await writeFiles(fixture.main, { "README.md": "base\n" });
      const base = await commitAll(fixture.git, fixture.main, "base");
      const slots = new WorktreeSlotManager({ wtRoot: fixture.wt, git: fixture.git });
      const handle = await slots.acquireSlot({
        projectId: PROJECT,
        mainRepoPath: fixture.main,
        baseCommit: base,
        taskId: "t038",
        attempt: 1,
      });
      const moved = path.join(fixture.root, "moved repo");
      extraRepos.push(moved);
      await fs.rename(fixture.main, moved);
      const repaired = await slots.repairWorktreesAfterMove({ projectId: PROJECT, mainRepoPath: moved });
      expect(repaired.mainRepoPath).toBe(path.resolve(moved));
      expect(repaired.repairedSlots.map((slot) => slot.headCommit)).toContain(handle.headCommit);
      const head = await gitOk(fixture.git, handle.slotPath, ["rev-parse", "HEAD"]);
      expect(head).toBe(handle.headCommit);
      const status = await fixture.git.execGit(["status", "--porcelain"], { cwd: handle.slotPath });
      expect(status.exitCode).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );
});
