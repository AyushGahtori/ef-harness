import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  AtomicBudgetReservationLedger,
  BudgetWindDownController,
  GitCheckpointStore,
  InMemoryIntegration,
  LocalKernelStop,
  StopEventStore,
  WipBranchHandoffExporter,
  runGit,
  vscodeCommand,
  type WipExportInput,
} from "../../src/budget-stops/index.js";
import { apiConnection } from "./helpers.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    const repo = path.join(root, "repo");
    if (fs.existsSync(repo)) {
      const listed = runGit(repo, ["worktree", "list", "--porcelain"]).stdout;
      for (const line of listed.split(/\r?\n/)) {
        const match = /^worktree (.+)$/.exec(line);
        const wt = match?.[1];
        if (wt && path.resolve(wt) !== path.resolve(repo)) {
          runGit(repo, ["worktree", "remove", "--force", wt]);
        }
      }
    }
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 40 });
  }
});

describe("wip branch handoff exporter", () => {
  it("exports a non-colliding wip branch with unverified commits and HANDOFF.md without moving main or integration", () => {
    const root = makeRoot();
    const repo = path.join(root, "repo");
    const worktrees = path.join(root, "worktrees");
    fs.mkdirSync(worktrees);
    const unmerged = seedRepo(repo);
    const integrationBefore = git(repo, ["rev-parse", "refs/heads/harness/integration"]);
    const mainBefore = git(repo, ["rev-parse", "refs/heads/main"]);
    git(repo, ["branch", "wip/kitchen-app-2026-11-19", "refs/heads/main"]);
    const occupied = git(repo, ["rev-parse", "refs/heads/wip/kitchen-app-2026-11-19"]);
    const kept = new GitCheckpointStore(repo).write({
      taskId: "T-kept",
      files: [{ path: "src/kept.ts", contents: "export const kept = true;\n" }],
      failingTestOutput: null,
    });
    const exporter = new WipBranchHandoffExporter();
    const result = exporter.exportBundle(sample(repo, worktrees, "2026-11-19", "commit", [unmerged]));
    expect(result.branch).toBe("wip/kitchen-app-2026-11-19-2");
    expect(git(repo, ["rev-parse", "refs/heads/wip/kitchen-app-2026-11-19"])).toBe(occupied);
    expect(git(repo, ["rev-parse", "refs/heads/main"])).toBe(mainBefore);
    expect(git(repo, ["rev-parse", "refs/heads/harness/integration"])).toBe(integrationBefore);
    expect(git(repo, ["branch", "--show-current"])).toBe("main");
    expect(git(repo, ["status", "--porcelain"])).toBe("");
    expect(git(repo, ["rev-parse", kept.ref])).toBe(kept.sha);
    const subjects = git(result.worktreePath, ["log", "--format=%s"]);
    expect(subjects).toContain("[WIP - UNVERIFIED: T-7]");
    expect(subjects).toContain("feat: verified unmerged");
    expect(git(repo, ["log", "refs/heads/harness/integration", "--format=%s"])).not.toContain("WIP - UNVERIFIED");
    expect(git(repo, ["log", "refs/heads/harness/integration", "--format=%s"])).not.toContain("verified unmerged");
    expect(git(repo, ["log", "refs/heads/main", "--format=%s"])).not.toContain("WIP - UNVERIFIED");
    expect(result.handoffMarkdown).toContain("Orders — DONE");
    expect(result.handoffMarkdown).toContain("Menu — DONE");
    expect(result.handoffMarkdown).toContain("AssertionError: cutoff expected 11:15 received 11:00");
    expect(result.handoffMarkdown).toContain("### T-8 Receipts");
    expect(result.handoffMarkdown).toContain("### T-9 Styles");
    expect(result.handoffMarkdown).toContain("### T-10 Preview");
    expect(result.handoffMarkdown).toContain("`pnpm test`");
    expect(result.handoffMarkdown).toContain("`pnpm dev`");
    expect(result.handoffMarkdown).toContain("I Fixed It Myself");
    expect(result.fixedItMyself.compatible).toBe(true);
    expect(result.openInVsCodeCommand).toBe(vscodeCommand(result.worktreePath));
    expect(result.openInVsCodeCommand.startsWith("code ")).toBe(true);
    expect(git(result.worktreePath, ["show", "HEAD:HANDOFF.md"])).toContain("### T-7 Cutoff");
    expect(git(result.worktreePath, ["merge-base", "--is-ancestor", integrationBefore, "HEAD"])).toBe("");

    const untracked = exporter.exportBundle(sample(repo, worktrees, "2026-11-20", "untracked", []));
    expect(git(untracked.worktreePath, ["status", "--porcelain"])).toContain("?? HANDOFF.md");
    expect(runGit(untracked.worktreePath, ["ls-files", "--error-unmatch", "HANDOFF.md"]).status).not.toBe(0);

    const excluded = exporter.exportBundle(sample(repo, worktrees, "2026-11-21", "excluded", []));
    expect(runGit(excluded.worktreePath, ["check-ignore", "-q", "HANDOFF.md"]).status).toBe(0);
    expect(git(excluded.worktreePath, ["status", "--porcelain"])).not.toContain("HANDOFF.md");
    expect(fs.readFileSync(excluded.handoffPath, "utf8")).toContain("src/cutoff.ts");
    expect(git(repo, ["rev-parse", "refs/heads/main"])).toBe(mainBefore);
    expect(git(repo, ["rev-parse", "refs/heads/harness/integration"])).toBe(integrationBefore);
  }, 60_000);

  it("halts at 100% through git checkpoints without moving main or harness/integration", () => {
    const root = makeRoot();
    const repo = path.join(root, "repo");
    seedRepo(repo);
    const integrationBefore = git(repo, ["rev-parse", "refs/heads/harness/integration"]);
    const mainBefore = git(repo, ["rev-parse", "refs/heads/main"]);
    const checkpoints = new GitCheckpointStore(repo);
    const kept = checkpoints.write({
      taskId: "T-kept",
      files: [{ path: "src/kept.ts", contents: "export const kept = true;\n" }],
      failingTestOutput: null,
    });
    const ledger = new AtomicBudgetReservationLedger({ microUsdLimit: 10_000_000, ppmLimit: null });
    ledger.postHistoricalSpend("micro-usd", 10_000_000);
    const integration = new InMemoryIntegration([{ sha: integrationBefore, featureId: null, subject: "base" }]);
    const kernel = new LocalKernelStop();
    const stopEvents = new StopEventStore();
    const controller = new BudgetWindDownController({
      ledger,
      integration,
      checkpoints,
      kernelStop: kernel,
      stopEvents,
      connections: [apiConnection()],
      activeConnectionId: "api",
      exporter: new WipBranchHandoffExporter(),
      now: () => 1_700_000_000_000,
    });
    controller.registerActive({
      workerId: "w7",
      taskId: "T-7",
      title: "Cutoff",
      featureId: "F-Print",
      role: "implementer@1",
      currency: "micro-usd",
      ceilingUnits: 10_000,
      step: 4,
      steps: 8,
      files: [{ path: "src/cutoff.ts", contents: "export const cutoff = \"11:00\";\n" }],
      failingTestOutput: "AssertionError: cutoff expected 11:15 received 11:00",
      acceptanceCriteria: [],
      safetyClass: null,
    });
    controller.observe();
    const saved = checkpoints.list().find((item) => item.taskId === "T-7");
    if (!saved) throw new Error("T-7 checkpoint was not written");
    expect(git(repo, ["rev-parse", "refs/heads/main"])).toBe(mainBefore);
    expect(git(repo, ["rev-parse", "refs/heads/harness/integration"])).toBe(integrationBefore);
    expect(git(repo, ["rev-parse", kept.ref])).toBe(kept.sha);
    expect(git(repo, ["rev-parse", saved.ref])).toBe(saved.sha);
    expect(git(repo, ["show", `${saved.sha}:src/cutoff.ts`])).toContain("11:00");
    expect(integration.history().map((commit) => commit.sha)).toEqual([integrationBefore]);
    expect(kernel.calls).toEqual(["budget_100"]);
    stopEvents.close();
  }, 60_000);
});

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ef-task128-"));
  roots.push(root);
  return root;
}

function git(repo: string, args: readonly string[]): string {
  const result = runGit(repo, args);
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`.trim());
  }
  return result.stdout.trim();
}

function seedRepo(repo: string): string {
  fs.mkdirSync(repo, { recursive: true });
  git(repo, ["init", "-b", "main"]);
  fs.writeFileSync(path.join(repo, "README.md"), "kitchen\n", "utf8");
  git(repo, ["add", "README.md"]);
  git(repo, ["-c", "commit.gpgsign=false", "commit", "-m", "initial"]);
  git(repo, ["branch", "harness/integration"]);
  git(repo, ["checkout", "harness/integration"]);
  writeCommit(repo, "src/orders.ts", "export const orders = true;\n", "feat: orders");
  writeCommit(repo, "src/menu.ts", "export const menu = true;\n", "feat: menu");
  git(repo, ["checkout", "-b", "feature-unmerged"]);
  writeCommit(repo, "src/unmerged.ts", "export const extra = true;\n", "feat: verified unmerged");
  const unmerged = git(repo, ["rev-parse", "HEAD"]);
  git(repo, ["checkout", "main"]);
  return unmerged;
}

function writeCommit(repo: string, filePath: string, contents: string, message: string): void {
  const full = path.join(repo, filePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents, "utf8");
  git(repo, ["add", "--", filePath]);
  git(repo, ["-c", "commit.gpgsign=false", "commit", "-m", message]);
}

function sample(
  repo: string,
  worktrees: string,
  date: string,
  placement: WipExportInput["handoffPlacement"],
  verifiedUnmergedShas: readonly string[],
): WipExportInput {
  return {
    repoPath: repo,
    projectSlug: "kitchen-app",
    date,
    handoffPlacement: placement,
    worktreeDirectory: worktrees,
    verifiedUnmergedShas,
    partialTasks: [
      {
        taskId: "T-7",
        title: "Cutoff",
        files: [{ path: "src/cutoff.ts", contents: "export const cutoff = \"11:00\";\n" }],
        failingTestOutput: "AssertionError: cutoff expected 11:15 received 11:00",
        acceptanceCriteria: ["managers can edit until 11:15"],
      },
    ],
    done: [
      { id: "F-Orders", title: "Orders" },
      { id: "F-Menu", title: "Menu" },
    ],
    remaining: [
      { taskId: "T-8", title: "Receipts", acceptanceCriteria: ["receipt lists the cutoff"] },
      { taskId: "T-9", title: "Styles", acceptanceCriteria: ["print styles match the menu"] },
      { taskId: "T-10", title: "Preview", acceptanceCriteria: ["preview opens locally"] },
    ],
    testCommand: "pnpm test",
    previewCommand: "pnpm dev",
  };
}
