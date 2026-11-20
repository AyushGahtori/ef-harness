import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  IntegrationLeaseRejectedError,
  IntegrationWorktreeController,
  IntegrationWorktreeExclusivityError,
  WorktreeSlotManager,
  readSlotOwnerMarker,
  type WorktreeLogEvent,
} from "../../src/worktrees/index.js";
import {
  TEST_TIMEOUT_MS,
  cleanupFixture,
  commitAll,
  createFixture,
  gitOk,
  stopBeforeReset,
  writeFiles,
  type Fixture,
} from "./helpers.js";

const PROJECT = "kitchen";

describe("integration and merge worktrees", () => {
  let fixture: Fixture | undefined;

  afterEach(async () => {
    if (fixture) await cleanupFixture(fixture);
    fixture = undefined;
  });

  it(
    "fast-forwards the persistent integration worktree under a live lease and rejects stale or unauthorized callers",
    async () => {
      fixture = await createFixture();
      const events: string[] = [];
      const warnings: WorktreeLogEvent[] = [];
      const slots = new WorktreeSlotManager({
        wtRoot: fixture.wt,
        git: fixture.git,
        onIntegrationAdvanced: (event) => {
          events.push(event.type);
        },
        logger: {
          warn(event) {
            warnings.push(event);
          },
          info() {
            return undefined;
          },
        },
      });
      const controller = new IntegrationWorktreeController(slots);
      await writeFiles(fixture.main, { "README.md": "v1\n" });
      const first = await commitAll(fixture.git, fixture.main, "v1");
      await gitOk(fixture.git, fixture.main, ["update-ref", "refs/heads/harness/integration", first]);
      const integration = await controller.ensureIntegrationWorktree({
        projectId: PROJECT,
        mainRepoPath: fixture.main,
        baseCommit: first,
      });
      const again = await controller.ensureIntegrationWorktree({
        projectId: PROJECT,
        mainRepoPath: fixture.main,
      });
      expect(again.slotPath).toBe(integration.slotPath);
      expect(integration.kind).toBe("integration");
      expect(path.basename(integration.slotPath)).toBe("integration");

      await writeFiles(fixture.main, { "README.md": "v2\n" });
      const second = await commitAll(fixture.git, fixture.main, "v2");
      await gitOk(fixture.git, fixture.main, ["update-ref", "refs/heads/harness/integration", second]);
      await controller.setIntegrationLease(PROJECT, fixture.main, { holderId: "merge-queue", epoch: 1 });
      const forwarded = await controller.fastForwardIntegrationWorktree({
        projectId: PROJECT,
        mainRepoPath: fixture.main,
        newSha: second,
        lease: { holderId: "merge-queue", epoch: 1, role: "project-merge-queue" },
      });
      expect(forwarded.newSha).toBe(second);
      expect(forwarded.previousSha).toBe(first);
      expect(forwarded.restartedPreview).toBe(true);
      expect(events).toEqual(["integration_worktree_advanced"]);
      await expect(gitOk(fixture.git, integration.slotPath, ["rev-parse", "HEAD"])).resolves.toBe(second);

      await controller.setIntegrationLease(PROJECT, fixture.main, { holderId: "merge-queue", epoch: 2 });
      await expect(
        controller.fastForwardIntegrationWorktree({
          projectId: PROJECT,
          mainRepoPath: fixture.main,
          newSha: second,
          lease: { holderId: "merge-queue", epoch: 1, role: "project-merge-queue" },
        }),
      ).rejects.toMatchObject({ reason: "stale_epoch" });
      await expect(
        controller.fastForwardIntegrationWorktree({
          projectId: PROJECT,
          mainRepoPath: fixture.main,
          newSha: second,
          lease: { holderId: "worker", epoch: 2, role: "worker" },
        }),
      ).rejects.toBeInstanceOf(IntegrationLeaseRejectedError);
      await expect(gitOk(fixture.git, integration.slotPath, ["rev-parse", "HEAD"])).resolves.toBe(second);

      await fs.writeFile(path.join(integration.slotPath, "README.md"), "dirty\n");
      await fs.writeFile(path.join(integration.slotPath, "stray.txt"), "nope\n");
      await writeFiles(fixture.main, { "README.md": "v3\n" });
      const third = await commitAll(fixture.git, fixture.main, "v3");
      await gitOk(fixture.git, fixture.main, ["update-ref", "refs/heads/harness/integration", third]);
      await controller.fastForwardIntegrationWorktree({
        projectId: PROJECT,
        mainRepoPath: fixture.main,
        newSha: third,
        lease: { holderId: "merge-queue", epoch: 2, role: "project-merge-queue" },
      });
      expect(warnings.some((event) => event.code === "integration_worktree_dirty")).toBe(true);
      expect((await readSlotOwnerMarker(integration.slotPath))?.kind).toBe("integration");
      await expect(fs.readFile(path.join(integration.slotPath, "README.md"), "utf8")).resolves.toBe("v3\n");
      await expect(fs.access(path.join(integration.slotPath, "stray.txt"))).rejects.toMatchObject({ code: "ENOENT" });

      await expect(
        controller.assertExecutionAllowed(PROJECT, fixture.main, integration.slotPath, "worker"),
      ).rejects.toBeInstanceOf(IntegrationWorktreeExclusivityError);
      await expect(
        controller.assertExecutionAllowed(PROJECT, fixture.main, integration.slotPath, "merge-candidate"),
      ).rejects.toBeInstanceOf(IntegrationWorktreeExclusivityError);
      await controller.assertExecutionAllowed(PROJECT, fixture.main, integration.slotPath, "app-preview");

      const other = new WorktreeSlotManager({ wtRoot: fixture.wt, git: fixture.git });
      await other.ensureIntegrationWorktree({ projectId: "other-app", mainRepoPath: fixture.main, baseCommit: third });
      await expect(
        other.fastForwardIntegrationWorktree({
          projectId: "other-app",
          mainRepoPath: fixture.main,
          newSha: third,
          lease: { holderId: "merge-queue", epoch: 1, role: "project-merge-queue" },
        }),
      ).rejects.toMatchObject({ reason: "missing_lease" });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "checks out fresh detached merge worktrees without disturbing the integration worktree",
    async () => {
      fixture = await createFixture();
      const slots = new WorktreeSlotManager({ wtRoot: fixture.wt, git: fixture.git });
      await writeFiles(fixture.main, { "README.md": "base\n" });
      const base = await commitAll(fixture.git, fixture.main, "base");
      await gitOk(fixture.git, fixture.main, ["branch", "harness/integration", base]);
      const integration = await slots.ensureIntegrationWorktree({
        projectId: PROJECT,
        mainRepoPath: fixture.main,
      });
      const feature = await slots.acquireMergeWorktree({
        projectId: PROJECT,
        mainRepoPath: fixture.main,
        baseCommit: base,
        purpose: "feature-integrator",
      });
      const project = await slots.acquireMergeWorktree({
        projectId: PROJECT,
        mainRepoPath: fixture.main,
        baseCommit: base,
        purpose: "project-integrator",
      });
      expect(feature.kind).toBe("merge");
      expect(project.slotPath).not.toBe(feature.slotPath);
      expect(feature.slotPath).not.toBe(integration.slotPath);
      expect(feature.headMode).toBe("detached");
      const symbolic = await fixture.git.execGit(["symbolic-ref", "-q", "HEAD"], { cwd: feature.slotPath });
      expect(symbolic.exitCode).not.toBe(0);
      await slots.assertExecutionAllowed(PROJECT, fixture.main, feature.slotPath, "merge-candidate");
      await expect(slots.releaseSlot({ projectId: PROJECT, mainRepoPath: fixture.main, slotId: feature.slotId, outcome: "merged" })).rejects.toBeInstanceOf(
        Error,
      );
      await expect(fs.access(feature.slotPath)).resolves.toBeUndefined();
      await slots.releaseSlot({
        projectId: PROJECT,
        mainRepoPath: fixture.main,
        slotId: feature.slotId,
        outcome: "merged",
        beforeSlotReset: stopBeforeReset,
      });
      await expect(fs.access(feature.slotPath)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(fs.access(integration.slotPath)).resolves.toBeUndefined();
    },
    TEST_TIMEOUT_MS,
  );
});
