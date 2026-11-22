import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  COLD_OPEN_DOMAINS,
  ColdOpenReconciler,
  PROJECT_FOLDER_MOVED,
  REENTRY_AWAITING_RESUME,
  assertReadOnlyGitArgs,
  createFileIndexLockPort,
  createReconcilePorts,
  createSpendLedger,
  decideLockSafety,
} from "../../src/reentry/index.js";
import { coldInput, commit, fakePorts, presentRepo, snapshot } from "./fixture.js";

describe("ColdOpenReconciler", () => {
  it("checks all 7 domains in under 2 seconds and blocks dispatch until Resume", () => {
    const state = snapshot({
      lastActiveAt: "2026-11-01T12:00:00.000Z",
      attempts: [
        attempt("a1", "T-1", 11, false),
        attempt("a2", "T-2", 12, false),
        attempt("a3", "T-3", 13, false),
        attempt("a4", "T-live", 14, true),
      ],
      remainingTasks: Array.from({ length: 6 }, (_, index) => ({ id: `R-${index}`, title: `Remaining ${index}` })),
      parkedTasks: [{ id: "P-1", title: "F12 print", progressLabel: "~70% done" }],
      finishedFeatures: [{ id: "F13", title: "F13 ordering", landedOn: "harness/integration" }],
      connections: [
        {
          provider: "chatgpt",
          allowanceLabel: "ChatGPT Plus",
          previousUsedPercent: 100,
          tokenExpiresAt: "2026-11-01T00:00:00.000Z",
        },
      ],
      cliVersions: [
        { name: "codex", version: "1.0.0" },
        { name: "claude", version: "1.0.0" },
        { name: "copilot", version: "1.0.0" },
        { name: "cursor", version: "1.0.0" },
        { name: "opencode", version: "1.0.0" },
      ],
      humanSteps: [
        { id: "docker", label: "Docker", status: "pending", probeId: "docker" },
        { id: "gh", label: "gh", status: "failed", probeId: "gh" },
      ],
      questions: [
        {
          id: "Q-11",
          prompt: "Can managers edit orders after cutoff?",
          openedAt: "2026-11-20T12:00:00.000Z",
          targetFiles: ["orders/edit.ts"],
          decisionContext: "whether managers can edit orders after cutoff",
          neededByTaskId: "T10",
          effectHint: "lets managers edit until 11:15",
          revalidation: "still_relevant",
          sinceLabel: "Friday",
        },
      ],
      failedTasks: [{ id: "T-4", writeScope: ["orders/**"], failingChecks: ["orders/edit.ts"] }],
      viewHashes: [{ path: ".harness/views/notes.md", sha256: "old" }],
    });
    const now = Date.now();
    const reconciler = new ColdOpenReconciler(
      fakePorts({
        livePids: new Set([14]),
        repo: presentRepo({
          branch: "feature/experiment",
          dirtyFiles: ["src/local.ts"],
          commits: [commit({ sha: "3f2a91c0", subject: "fix cutoff tz", files: ["orders/edit.ts"] })],
          originMainHead: "origin-moved",
          indexLockPath: "D:/code/kitchen/.git/index.lock",
          indexLockMtimeMs: now - 120_000,
        }),
        worktrees: [
          { slotId: "wt-stale", path: "wt/stale", state: "stale", liveHead: "other", indexLockPath: null, indexLockMtimeMs: null },
          {
            slotId: "wt-locked",
            path: "wt/locked",
            state: "locked",
            liveHead: "head",
            indexLockPath: "wt/locked/.git/index.lock",
            indexLockMtimeMs: now - 1_000,
          },
          { slotId: "wt-gone", path: "wt/gone", state: "deleted", liveHead: null, indexLockPath: null, indexLockMtimeMs: null },
        ],
        views: [{ path: ".harness/views/notes.md", sha256: "new" }],
        locks: { packageJson: "pkg-hash", pnpmLock: "lock-new" },
        disk: { ok: false, freeBytes: 1024, detail: "Low disk headroom — free space is below 5 GB" },
        clis: [
          { name: "codex", version: "1.2.0" },
          { name: "claude", version: "1.2.0" },
          { name: "copilot", version: "1.2.0" },
          { name: "cursor", version: "1.2.0" },
          { name: "opencode", version: "1.2.0" },
        ],
        observe: () => ({
          provider: "chatgpt",
          usedPercent: 0,
          allowanceReset: true,
          fiveHourReset: true,
          weeklyReset: true,
          tokenExpired: true,
          expiresInDays: null,
        }),
        probe: () => ({ status: "verified", evidence: "present" }),
      }),
    );
    const ledger = createSpendLedger();
    const report = reconciler.reconcile(coldInput(state, { ledger, nowIso: "2026-11-22T12:00:00.000Z" }));

    expect(report.elapsedMs).toBeLessThan(2000);
    expect(report.domains.map((domain) => domain.id)).toEqual([...COLD_OPEN_DOMAINS]);
    expect(report.domains.every((domain) => domain.checked)).toBe(true);
    expect(report.tokensSpent).toBe(0);
    expect(report.centsSpent).toBe(0);
    expect(report.paidCallBlocked).toBe(false);
    expect(report.mutations).toEqual([]);
    expect(report.integrationHead).toBe("integration-head");
    expect(report.integrationHeadMatches).toBe(true);
    expect(report.orphans.map((item) => item.id)).toEqual(["a1", "a2", "a3"]);
    expect(report.interruptedMessage).toBe(
      "3 tasks were interrupted by an unexpected shutdown — checkpoints recovered cleanly",
    );
    expect(report.branchPrompt).toBe(
      "Your repo is now on 'feature/experiment' — Sync harness base or keep building against 'main'?",
    );
    expect(report.lockfilePrompts).toEqual([
      "You updated dependencies while away — Include in integration base?",
      "Include new dependency in harness/integration before resuming?",
    ]);
    expect(report.allowanceMessages).toContain("ChatGPT allowance has reset!");
    expect(report.allowanceMessages).toContain("ChatGPT Plus allowance has reset — Ready to resume 6 remaining tasks");
    expect(report.staleContextReminder).toContain("more than 7 days");
    expect(report.staleContextReminder).toContain("origin/main");
    expect(report.whatChanged.join("\n")).toContain("Docker — verified");
    expect(report.whatChanged.join("\n")).toContain("gh — verified");
    expect(report.whatChanged.join("\n")).toContain("codex updated from 1.0.0 to 1.2.0");
    expect(report.whatChanged.join("\n")).toContain("claude updated from 1.0.0 to 1.2.0");
    expect(report.whatChanged.join("\n")).toContain("copilot updated from 1.0.0 to 1.2.0");
    expect(report.whatChanged.join("\n")).toContain("cursor updated from 1.0.0 to 1.2.0");
    expect(report.whatChanged.join("\n")).toContain("opencode updated from 1.0.0 to 1.2.0");
    expect(report.whatChanged.join("\n")).toContain("Offline Markdown edit: .harness/views/notes.md");
    expect(report.whatChanged.join("\n")).toContain("Uncommitted files: src/local.ts");
    expect(report.whatChanged.join("\n")).toContain("fix cutoff tz");
    expect(report.whatChanged.join("\n")).toContain("Mark verified or Keep open?");
    expect(report.commitAnswered.every((match) => match.autoClosed === false)).toBe(true);
    expect(report.whereWeLeftOff.join("\n")).toContain("Phase: Wave 2 · ordering");
    expect(report.whereWeLeftOff.join("\n")).toContain("Why it stopped: budget");
    expect(report.whereWeLeftOff.join("\n")).toContain("F13 ordering");
    expect(report.whereWeLeftOff.join("\n")).toContain("F12 print");
    expect(report.readyLines.join("\n")).toContain("Remaining: 6 tasks");
    expect(report.gate.phase).toBe(REENTRY_AWAITING_RESUME);
    expect(report.gate.tryActivity("start_worker").allowed).toBe(false);
    expect(report.gate.tryActivity("edit_file").allowed).toBe(false);
    expect(report.gate.tryActivity("spend_tokens").allowed).toBe(false);
    expect(report.gate.tryActivity("mutate_git").allowed).toBe(false);
    expect(report.actions.some((action) => action.type === "recover_orphaned_attempts" && !action.requiresConfirmation)).toBe(
      true,
    );
    expect(report.actions.some((action) => action.type === "resolve_commit_answered" && action.requiresConfirmation)).toBe(
      true,
    );
    expect(state.attempts.find((item) => item.id === "a1")?.status).toBe("WORKING");
  });

  it("skips the welcome hold for an untouched newly opened idle project", () => {
    const report = new ColdOpenReconciler(fakePorts()).reconcile(
      coldInput(snapshot(), { reopen: "first_open", lastActiveLabel: null }),
    );
    expect(report.showWelcome).toBe(false);
    expect(report.gate.phase).toBe("OPEN");
    expect(report.gate.tryActivity("start_worker").allowed).toBe(true);
  });

  it("reports a moved project folder without throwing", () => {
    const missing = path.join(tmpdir(), "ef-harness-missing-project-130");
    rmSync(missing, { recursive: true, force: true });
    const state = snapshot({ projectRoot: missing });
    const reconciler = new ColdOpenReconciler(
      createReconcilePorts(state, {
        processes: { reliable: true, isAlive: () => false, liveGitPids: () => [] },
      }),
    );
    const report = reconciler.reconcile(coldInput(state));
    expect(report.folderMissing).toBe(true);
    expect(report.relocatePrompt).toBe(PROJECT_FOLDER_MOVED);
    expect(report.whatChanged).toContain(PROJECT_FOLDER_MOVED);
    expect(report.gate.click("Resume Build")).toBe(REENTRY_AWAITING_RESUME);
  });

  it("keeps a live index lock and only plans removal for a stale one", () => {
    const now = Date.now();
    const state = snapshot();
    const report = new ColdOpenReconciler(
      fakePorts({
        repo: presentRepo({
          indexLockPath: "D:/repo/.git/index.lock",
          indexLockMtimeMs: now - 120_000,
        }),
        worktrees: [
          {
            slotId: "live",
            path: "wt/live",
            state: "locked",
            liveHead: "head",
            indexLockPath: "wt/live/.git/index.lock",
            indexLockMtimeMs: now - 5_000,
          },
        ],
      }),
    ).reconcile(coldInput(state));
    const stale = report.actions.find((action) => action.lockPath === "D:/repo/.git/index.lock");
    const live = report.actions.find((action) => action.lockPath === "wt/live/.git/index.lock");
    expect(stale?.type).toBe("prune_stale_index_lock");
    expect(live).toBeUndefined();
    expect(report.whatChanged.join("\n")).toContain("index lock is newer than 60 seconds");
  });

  it("does not spend tokens and surfaces a paid-call violation if a port does", () => {
    const state = snapshot({
      connections: [
        { provider: "chatgpt", allowanceLabel: "ChatGPT Plus", previousUsedPercent: 0, tokenExpiresAt: null },
      ],
    });
    const ledger = createSpendLedger();
    const ports = fakePorts();
    const reconciler = new ColdOpenReconciler({
      ...ports,
      connections: {
        observe: (item) => {
          ledger.tokens += 10;
          ledger.cents += 2;
          ledger.calls.push("llm");
          return {
            provider: item.provider,
            usedPercent: item.previousUsedPercent,
            allowanceReset: false,
            fiveHourReset: false,
            weeklyReset: false,
            tokenExpired: false,
            expiresInDays: null,
          };
        },
      },
    });
    const report = reconciler.reconcile(coldInput(state, { ledger }));
    expect(report.paidCallBlocked).toBe(true);
    expect(report.tokensSpent).toBe(10);
    expect(report.gate.tryActivity("spend_tokens").allowed).toBe(false);
  });

  it("simulates offline edits, manual commits, branch drift, and lockfile drift without writing the repo", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ef-reentry-"));
    try {
      git(root, ["init", "-b", "main"]);
      write(root, "package.json", '{"name":"kitchen"}\n');
      write(root, "pnpm-lock.yaml", "lockfileVersion: 1\n");
      write(root, ".harness/views/notes.md", "# notes\n");
      write(root, "src/orders/edit.ts", "export const cutoff = 1;\n");
      git(root, ["add", "."]);
      git(root, ["-c", "user.email=reentry@example.com", "-c", "user.name=Reentry Test", "commit", "-m", "base"]);
      const baseHead = git(root, ["rev-parse", "HEAD"]).trim();
      const packageHash = sha(path.join(root, "package.json"));
      const lockHash = sha(path.join(root, "pnpm-lock.yaml"));
      write(root, "src/orders/edit.ts", "export const cutoff = 2;\n");
      git(root, ["add", "src/orders/edit.ts"]);
      git(root, ["-c", "user.email=reentry@example.com", "-c", "user.name=Reentry Test", "commit", "-m", "fix cutoff tz"]);
      git(root, ["checkout", "-b", "feature/experiment"]);
      git(root, ["update-ref", "refs/heads/harness/integration", baseHead]);
      write(root, "pnpm-lock.yaml", "lockfileVersion: 2\n");
      write(root, ".harness/views/notes.md", "# notes changed\n");
      write(root, "src/dirty.ts", "export const dirty = true;\n");
      const before = fingerprint(root);
      const viewBefore = sha(path.join(root, ".harness/views/notes.md"));
      const fixed = snapshot({
        projectRoot: root,
        recordedBranch: "main",
        recordedHead: baseHead,
        expectedIntegrationHead: baseHead,
        recordedOriginMain: null,
        lockHashes: { packageJson: packageHash, pnpmLock: lockHash },
        viewHashes: [{ path: ".harness/views/notes.md", sha256: "0".repeat(64) }],
      });
      const reconciler = new ColdOpenReconciler(
        createReconcilePorts(fixed, {
          processes: { reliable: true, isAlive: () => false, liveGitPids: () => [] },
        }),
      );
      const report = reconciler.reconcile(coldInput(fixed));
      expect(report.elapsedMs).toBeLessThan(2000);
      expect(report.mutations).toEqual([]);
      expect(report.branchPrompt).toContain("feature/experiment");
      expect(report.lockfilePrompts[0]).toContain("You updated dependencies while away");
      expect(report.whatChanged.join("\n")).toContain("Offline Markdown edit: .harness/views/notes.md");
      expect(report.whatChanged.join("\n")).toContain("src/dirty.ts");
      expect(report.whatChanged.join("\n")).toContain("fix cutoff tz");
      expect(fingerprint(root)).toBe(before);
      expect(sha(path.join(root, ".harness/views/notes.md"))).toBe(viewBefore);
      expect(git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).trim()).toBe("feature/experiment");
      expect(git(root, ["rev-parse", "refs/heads/harness/integration"]).trim()).toBe(baseHead);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not delete a fresh index lock and removes only a stale one on confirmed resume", () => {
    const fresh = mkdtempSync(path.join(tmpdir(), "ef-reentry-fresh-"));
    const stale = mkdtempSync(path.join(tmpdir(), "ef-reentry-stale-"));
    try {
      const freshLock = prepareRepo(fresh);
      const staleLock = prepareRepo(stale);
      const past = new Date(Date.now() - 120_000);
      utimesSync(staleLock, past, past);
      const processes = { reliable: true, isAlive: () => false, liveGitPids: () => [] as number[] };
      const freshReport = new ColdOpenReconciler(
        createReconcilePorts(snapshot({ projectRoot: fresh, recordedHead: head(fresh), expectedIntegrationHead: head(fresh) }), {
          processes,
        }),
      ).reconcile(coldInput(snapshot({ projectRoot: fresh, recordedBranch: "main", recordedHead: head(fresh), expectedIntegrationHead: head(fresh), recordedOriginMain: null })));
      expect(existsSync(freshLock)).toBe(true);
      expect(freshReport.actions.some((action) => action.type === "prune_stale_index_lock")).toBe(false);

      const staleState = snapshot({
        projectRoot: stale,
        recordedBranch: "main",
        recordedHead: head(stale),
        expectedIntegrationHead: head(stale),
        recordedOriginMain: null,
      });
      const staleReport = new ColdOpenReconciler(createReconcilePorts(staleState, { processes })).reconcile(coldInput(staleState));
      expect(existsSync(staleLock)).toBe(true);
      expect(staleReport.actions.some((action) => action.lockPath === staleLock)).toBe(true);
    } finally {
      rmSync(fresh, { recursive: true, force: true });
      rmSync(stale, { recursive: true, force: true });
    }
  });
});

describe("read-only git and lock safety", () => {
  it("refuses stash, checkout, and clean during a cold open", () => {
    expect(() => assertReadOnlyGitArgs(["stash"])).toThrow(/Refusing git command/);
    expect(() => assertReadOnlyGitArgs(["checkout", "main"])).toThrow(/Refusing git command/);
    expect(() => assertReadOnlyGitArgs(["clean", "-fd"])).toThrow(/Refusing git command/);
    expect(() => assertReadOnlyGitArgs(["status", "--porcelain=v1"])).not.toThrow();
  });

  it("treats a lock under 60 seconds or any live git pid as unsafe", () => {
    expect(decideLockSafety({ present: true, ageMs: 59_999, liveGitPids: [], probeReliable: true }).safe).toBe(false);
    expect(decideLockSafety({ present: true, ageMs: 60_000, liveGitPids: [], probeReliable: true }).safe).toBe(true);
    expect(decideLockSafety({ present: true, ageMs: 120_000, liveGitPids: [4], probeReliable: true }).safe).toBe(false);
    expect(decideLockSafety({ present: true, ageMs: 120_000, liveGitPids: [], probeReliable: false }).safe).toBe(false);
    expect(decideLockSafety({ present: false, ageMs: null, liveGitPids: [], probeReliable: true }).safe).toBe(false);
  });

  it("refuses to delete when the lock becomes live before resume", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ef-reentry-race-"));
    try {
      const lock = prepareRepo(root);
      const past = new Date(Date.now() - 120_000);
      utimesSync(lock, past, past);
      const pids: number[] = [];
      const processes = { reliable: true, isAlive: () => false, liveGitPids: () => pids };
      const state = snapshot({
        projectRoot: root,
        recordedBranch: "main",
        recordedHead: head(root),
        expectedIntegrationHead: head(root),
        recordedOriginMain: null,
      });
      const report = new ColdOpenReconciler(createReconcilePorts(state, { processes })).reconcile(coldInput(state));
      utimesSync(lock, new Date(), new Date());
      pids.push(99);
      const port = createFileIndexLockPort(processes);
      expect(port.assess(lock).safe).toBe(false);
      expect(() => port.remove(lock)).toThrow(/Refusing to delete a live git lock/);
      expect(existsSync(lock)).toBe(true);
      expect(report.actions.some((action) => action.type === "prune_stale_index_lock")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function attempt(id: string, taskId: string, pid: number, alive: boolean) {
  return {
    id,
    taskId,
    status: "WORKING" as const,
    pid,
    checkpointRef: `refs/checkpoints/${id}`,
    wipDiffPreserved: !alive,
  };
}

function git(cwd: string, args: readonly string[]): string {
  const result = spawnSync("git", [...args], { cwd, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  }
  return result.stdout;
}

function write(root: string, file: string, contents: string): void {
  const full = path.join(root, file);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, contents);
}

function sha(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function fingerprint(root: string): string {
  const status = git(root, ["status", "--porcelain=v1", "-uall"]);
  const head = git(root, ["rev-parse", "HEAD"]);
  const branch = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const files = ["package.json", "pnpm-lock.yaml", ".harness/views/notes.md", "src/orders/edit.ts", "src/dirty.ts"]
    .map((file) => `${file}:${sha(path.join(root, file))}`)
    .join("|");
  return `${branch}${head}${status}${files}`;
}

function prepareRepo(root: string): string {
  git(root, ["init", "-b", "main"]);
  write(root, "README.md", "kitchen\n");
  git(root, ["add", "README.md"]);
  git(root, ["-c", "user.email=reentry@example.com", "-c", "user.name=Reentry Test", "commit", "-m", "base"]);
  const current = head(root);
  git(root, ["update-ref", "refs/heads/harness/integration", current]);
  const lock = path.join(root, ".git", "index.lock");
  writeFileSync(lock, "locked\n");
  return lock;
}

function head(root: string): string {
  return git(root, ["rev-parse", "HEAD"]).trim();
}
