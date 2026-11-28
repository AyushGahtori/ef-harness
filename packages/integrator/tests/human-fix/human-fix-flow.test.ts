import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  HUMAN_ENTRY_CARD,
  HUMAN_ENTRY_CHAT,
  HUMAN_ENTRY_COMMIT,
  HUMAN_FIX_TRAILER_AUTHOR_MODE,
  HUMAN_OWNED,
  OVERRIDE_ACCEPT_ANYWAY,
  OVERRIDE_TEST_WRONG,
  VERIFICATION_HUMAN_OVERRIDE,
  WORKSPACE_TASK_WORKTREE,
} from "../../src/human-fix/constants.js";
import { HumanFixFlowEngine } from "../../src/human-fix/flow-engine.js";
import { GitRepo } from "../../src/human-fix/git.js";
import {
  InMemoryCleanVerifier,
  InMemoryHintLadder,
  InMemoryMergeQueue,
  InMemoryWorktreeSlots,
} from "../../src/human-fix/ports.js";
import { HumanVerificationOverridePolicy } from "../../src/human-fix/override-policy.js";
import { VerificationFailedError } from "../../src/human-fix/errors.js";
import type { ActiveScopeOverlapDetectorPort, CleanVerifierHarnessPort } from "../../src/human-fix/ports.js";
import type { DeveloperIdentity, FailingCheck } from "../../src/human-fix/types.js";

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

function write(root: string, relative: string, text: string): void {
  const full = path.join(root, ...relative.split("/"));
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, text.replaceAll("\r\n", "\n"), "utf8");
}

function initRepo(identity: DeveloperIdentity): { root: string; repo: string; git: GitRepo; base: string } {
  const root = mkdtempSync(path.join(tmpdir(), "ef-human-fix-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  mkdirSync(repo);
  const git = new GitRepo(repo);
  git.ok(["init", "--initial-branch=harness/integration"]);
  git.setIdentity(identity);
  write(repo, "README.md", "base\n");
  git.ok(["add", "-A"]);
  git.ok(["commit", "-m", "base"]);
  const base = git.revParse("HEAD");
  return { root, repo, git, base };
}

function buildEngine(
  root: string,
  repo: string,
  identity: DeveloperIdentity,
  verifier: CleanVerifierHarnessPort,
  overlap: ActiveScopeOverlapDetectorPort = { findCollidingActiveTask: () => null },
): { engine: HumanFixFlowEngine; merge: InMemoryMergeQueue } {
  const merge = new InMemoryMergeQueue();
  const engine = new HumanFixFlowEngine({
    repo,
    stateFile: path.join(root, "state.db"),
    mainCheckoutPath: repo,
    verifier,
    slots: new InMemoryWorktreeSlots(
      new Map([["T-6", { path: path.join(root, "wt-t6"), branch: "harness/t/T-6" }]]),
    ),
    overlap,
    mergeQueue: merge,
    hintLadder: new InMemoryHintLadder(),
  });
  return { engine, merge };
}

const DEV: DeveloperIdentity = { name: "Ayush Gahtori", email: "ayush@example.com" };

describe("human-fix flow", { timeout: 60_000 }, () => {
  it("transitions all 3 entry points to HUMAN_OWNED and pauses only direct downstream tasks", () => {
    const { root, repo } = initRepo(DEV);
    const { engine } = buildEngine(root, repo, DEV, new InMemoryCleanVerifier(new Map(), DEV));
    try {
      engine.state.seedTask({
        taskId: "T-4",
        featureId: "F-Menu",
        state: "ESCALATED",
        writeScope: ["src/features/menu/fix.ts"],
        downstreamTaskIds: ["T-5"],
        workerPid: 4242,
      });
      engine.state.seedTask({ taskId: "T-5", featureId: "F-Menu", state: "READY", writeScope: ["src/features/menu/next.ts"] });
      engine.state.seedTask({ taskId: "T-9", featureId: "F-Other", state: "CODING", writeScope: ["src/features/other/a.ts"], workerPid: 99 });
      engine.state.registerActiveWorker("T-9", 99, ["src/features/other/a.ts"]);

      const card = engine.takeover.fromCard("T-4");
      expect(card.state).toBe(HUMAN_OWNED);
      expect(card.entry).toBe(HUMAN_ENTRY_CARD);
      expect(card.haltedWorkerPid).toBe(4242);
      expect(card.pausedDownstreamTaskIds).toEqual(["T-5"]);
      expect(engine.state.getTask("T-9")?.state).toBe("CODING");

      engine.state.setTaskState("T-4", "CODING");
      const chat = engine.takeover.fromChat("I fixed task T-4 myself");
      expect(chat.entry).toBe(HUMAN_ENTRY_CHAT);
      expect(engine.state.requireTask("T-4").state).toBe(HUMAN_OWNED);

      engine.state.setTaskState("T-4", "EXHAUSTED");
      const commit = engine.takeover.fromCommitDetection("T-4", "abc123");
      expect(commit.entry).toBe(HUMAN_ENTRY_COMMIT);
      expect(engine.state.requireTask("T-4").state).toBe(HUMAN_OWNED);
    } finally {
      engine.close();
    }
  });

  it("offers VS Code worktree picker and preserves true developer git authorship on verify", async () => {
    const { root, repo, git, base } = initRepo(DEV);
    const { engine } = buildEngine(root, repo, DEV, new InMemoryCleanVerifier(new Map(), DEV));
    try {
      engine.state.seedTask({
        taskId: "T-6",
        featureId: "F-Orders",
        state: "ESCALATED",
        writeScope: ["src/features/orders/handler.ts"],
      });
      engine.takeover.fromCard("T-6");
      const picker = engine.workspace.present("T-6");
      expect(picker.options[0]?.id).toBe(WORKSPACE_TASK_WORKTREE);
      expect(picker.options[0]?.vscodeCommand).toBe(`code ${path.join(root, "wt-t6")}`);

      write(repo, "src/features/orders/handler.ts", "export const status = 422;\n");
      const result = await engine.cleanVerifier.verifyAndContinue({
        taskId: "T-6",
        repo: git,
        baseSha: base,
        paths: ["src/features/orders/handler.ts"],
      });
      expect(result.ok).toBe(true);
      expect(result.author).toEqual(DEV);
      expect(git.parseTrailer(result.commitSha, HUMAN_FIX_TRAILER_AUTHOR_MODE)).toBe("human-fixed");
      const authorLine = git.ok(["log", "-1", "--format=%an <%ae>", result.commitSha]).stdout.trim();
      expect(authorLine).toBe("Ayush Gahtori <ayush@example.com>");
    } finally {
      engine.close();
    }
  });

  it("reconciles out-of-scope files and contract deltas into state.db with explicit basis", () => {
    const { root, repo, git, base } = initRepo(DEV);
    const { engine } = buildEngine(root, repo, DEV, new InMemoryCleanVerifier(new Map(), DEV));
    try {
      engine.state.seedTask({
        taskId: "T-6",
        featureId: "F-Orders",
        state: HUMAN_OWNED,
        writeScope: ["src/features/orders/handler.ts"],
      });
      write(repo, "src/features/orders/handler.ts", "export const status = 422;\n");
      write(repo, "src/lib/dates.ts", "export const fmt = (v: string) => v;\n");
      write(repo, "src/contracts/order.ts", "export const cutoffGraceMinutes = 5;\n");
      git.ok(["add", "-A"]);
      git.ok(["commit", "-m", "human edits"], DEV);
      const head = git.revParse("HEAD");
      const reconcile = engine.reconciler.reconcile({
        taskId: "T-6",
        repo: git,
        baseSha: base,
        headSha: head,
        confirmExtraFiles: true,
        confirmContract: true,
      });
      expect(reconcile.includedPaths).toEqual(
        expect.arrayContaining(["src/lib/dates.ts", "src/contracts/order.ts"]),
      );
      expect(reconcile.contractUpdates).toEqual([
        expect.objectContaining({ contractId: "Order", field: "cutoffGraceMinutes", basis: "explicit" }),
      ]);
      expect(engine.state.listContracts("T-6")[0]?.basis).toBe("explicit");
    } finally {
      engine.close();
    }
  });

  it("routes this test is wrong to updated spec and re-verify green", async () => {
    const { root, repo, git, base } = initRepo(DEV);
    const failing = new Map<string, FailingCheck>([
      ["sealed_status_400", { id: "sealed_status_400", title: "sealed status", output: "expected 400", sealed: true }],
    ]);
    const { engine, merge } = buildEngine(root, repo, DEV, new InMemoryCleanVerifier(failing, DEV));
    try {
      engine.state.seedTask({
        taskId: "T-6",
        featureId: "F-Orders",
        state: HUMAN_OWNED,
        writeScope: ["src/features/orders/handler.ts"],
        downstreamTaskIds: ["T-7"],
      });
      engine.state.seedTask({ taskId: "T-7", featureId: "F-Orders", state: "PARKED", writeScope: ["src/features/orders/next.ts"] });
      write(repo, "src/features/orders/handler.ts", "export const status = 422;\n");
      git.ok(["add", "src/features/orders/handler.ts"]);
      await expect(
        engine.cleanVerifier.verifyAndContinue({
          taskId: "T-6",
          repo: git,
          baseSha: base,
          paths: ["src/features/orders/handler.ts"],
        }),
      ).rejects.toBeInstanceOf(VerificationFailedError);
      const sha = git.revParse("HEAD");

      const policy = new HumanVerificationOverridePolicy(
        engine.state,
        new InMemoryCleanVerifier(new Map(), DEV),
        new InMemoryHintLadder(),
        merge,
      );
      const resolved = await policy.resolve({
        taskId: "T-6",
        commitSha: sha,
        author: DEV,
        choice: { kind: OVERRIDE_TEST_WRONG, reason: "Use 422 Unprocessable Entity for domain cutoff errors" },
        failingChecks: [{ id: "sealed_status_400", title: "sealed", output: "expected 400", sealed: true }],
      });
      expect(resolved.landed).toBe(true);
      expect(resolved.updatedSpecIds).toContain("spec-for-sealed_status_400");
      expect(merge.queue).toHaveLength(1);
      expect(engine.state.getTask("T-7")?.state).toBe("READY");
    } finally {
      engine.close();
    }
  });

  it("records honest accept anyway override without faking PASS", async () => {
    const { root, repo } = initRepo(DEV);
    const failing = new Map<string, FailingCheck>([
      ["flaky_external", { id: "flaky_external", title: "flaky external", output: "timeout" }],
    ]);
    const { engine } = buildEngine(root, repo, DEV, new InMemoryCleanVerifier(failing, DEV));
    try {
      engine.state.seedTask({
        taskId: "T-6",
        featureId: "F-Orders",
        state: HUMAN_OWNED,
        writeScope: ["src/features/orders/handler.ts"],
        downstreamTaskIds: ["T-8"],
      });
      engine.state.seedTask({ taskId: "T-8", featureId: "F-Orders", state: "PARKED", writeScope: ["src/x.ts"] });
      const sha = createHash("sha256").update("commit").digest("hex");
      const resolved = await engine.overridePolicy.resolve({
        taskId: "T-6",
        commitSha: sha,
        author: DEV,
        choice: { kind: OVERRIDE_ACCEPT_ANYWAY, reason: "ship urgently" },
        failingChecks: [{ id: "flaky_external", title: "flaky", output: "timeout" }],
      });
      expect(resolved.verificationStatus).toBe(VERIFICATION_HUMAN_OVERRIDE);
      expect(resolved.overriddenCheckIds).toEqual(["flaky_external"]);
      expect(resolved.landingSummaryLine).toContain("flaky_external");
      const task = engine.state.requireTask("T-6");
      expect(task.verificationStatus).toBe(VERIFICATION_HUMAN_OVERRIDE);
    } finally {
      engine.close();
    }
  });

  it("hands back to AI keeping partial human edits and guidance", () => {
    const { root, repo, git } = initRepo(DEV);
    const { engine } = buildEngine(root, repo, DEV, new InMemoryCleanVerifier(new Map(), DEV));
    try {
      engine.state.seedTask({
        taskId: "T-6",
        featureId: "F-Orders",
        state: HUMAN_OWNED,
        writeScope: ["src/features/orders/sketch.ts"],
      });
      write(repo, "src/features/orders/sketch.ts", "export const sketch = true;\n");
      const back = engine.handBackToAi({
        taskId: "T-6",
        keepEdits: true,
        guidanceNote: "finish print layout with flex gap 16",
      });
      expect(back.resumedState).toBe("CODING");
      expect(back.wipCommitSha).toBeTruthy();
      expect(git.parseTrailer(back.wipCommitSha ?? "", HUMAN_FIX_TRAILER_AUTHOR_MODE)).toBe("human-fixed");
      expect(engine.aiPreservePrompt("T-6")).toContain("Preserve developer's human-fixed implementation");
    } finally {
      engine.close();
    }
  });

  it("holds a colliding sibling worker when out-of-scope file overlaps active scope", () => {
    const { root, repo, git, base } = initRepo(DEV);
    const overlap: ActiveScopeOverlapDetectorPort = {
      findCollidingActiveTask(paths: readonly string[], except: string) {
        if (paths.includes("src/shared/conflict.ts") && except === "T-6") return "T-9";
        return null;
      },
    };
    const { engine } = buildEngine(root, repo, DEV, new InMemoryCleanVerifier(new Map(), DEV), overlap);
    try {
      engine.state.seedTask({
        taskId: "T-6",
        featureId: "F-A",
        state: HUMAN_OWNED,
        writeScope: ["src/features/a/fix.ts"],
      });
      engine.state.registerActiveWorker("T-9", 77, ["src/shared/conflict.ts"]);
      write(repo, "src/shared/conflict.ts", "export const v = 1;\n");
      git.ok(["add", "src/shared/conflict.ts"]);
      git.ok(["commit", "-m", "touch shared"], DEV);
      const head = git.revParse("HEAD");
      const result = engine.reconciler.reconcile({
        taskId: "T-6",
        repo: git,
        baseSha: base,
        headSha: head,
        confirmExtraFiles: true,
      });
      expect(result.heldSiblingTaskIds).toContain("T-9");
    } finally {
      engine.close();
    }
  });
});