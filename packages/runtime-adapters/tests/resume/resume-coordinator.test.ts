import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ManualClock } from "../../src/resume/clock.js";
import { SqliteAttemptCheckpointStore } from "../../src/resume/checkpoint-store.js";
import {
  ForeignRuntimeResumeCoordinator,
  createForeignRuntimeResumeCoordinator,
} from "../../src/resume/coordinator.js";
import type { CrashInput, PersistInput } from "../../src/resume/coordinator.js";
import { LocalGitTreeSafety } from "../../src/resume/git-work.js";
import {
  IdentityBriefCompiler,
  OsChildProcesses,
  ScriptedChildProcesses,
} from "../../src/resume/ports.js";
import type { BriefCompilerPort, ChildProcessPort, WorktreeSlotPort } from "../../src/resume/ports.js";
import {
  IDLE_PARK_AFTER_MS,
  LARGE_WIP_FILE_BYTES,
  PRIOR_UNVERIFIED_WIP,
  PRIOR_UNVERIFIED_WIP_HEADER,
  WIP_HANDOFF_TOKEN_LIMIT,
  estimateTokens,
} from "../../src/resume/types.js";
import type { CompiledBrief, ForeignRuntimeCheckpoint } from "../../src/resume/types.js";
import {
  FakeAdapter,
  brief,
  commitFile,
  indexSha256,
  initRepo,
  readSlot,
  slotExists,
} from "./fixture.js";

const cleanups: Array<() => void> = [];
const processes: OsChildProcesses[] = [];

afterEach(() => {
  for (const proc of processes) proc.dispose();
  processes.length = 0;
  for (const cleanup of cleanups) cleanup();
  cleanups.length = 0;
});

function repoPath(): string {
  const created = initRepo();
  cleanups.push(created.cleanup);
  return created.repo;
}

function adapters() {
  const codex = new FakeAdapter("codex", "1.2.3");
  const claude = new FakeAdapter("claude-code", "2.1.0");
  const opencode = new FakeAdapter("opencode", "0.4.1");
  const copilot = new FakeAdapter("copilot", "1.4.0");
  const cursor = new FakeAdapter("cursor", "1.1.0");
  const native = new FakeAdapter("native-worker-loop", "1.0.0");
  const map = new Map<string, FakeAdapter>([
    [codex.adapterId, codex],
    [claude.adapterId, claude],
    [opencode.adapterId, opencode],
    [copilot.adapterId, copilot],
    [cursor.adapterId, cursor],
    [native.adapterId, native],
  ]);
  return { codex, claude, opencode, copilot, cursor, native, map };
}

function coordinatorFor(input: {
  readonly map: Map<string, FakeAdapter>;
  readonly clock?: ManualClock;
  readonly processes?: ChildProcessPort;
  readonly slots?: WorktreeSlotPort;
  readonly briefs?: BriefCompilerPort;
  readonly resumeTimeoutMs?: number;
  readonly store?: SqliteAttemptCheckpointStore;
}): ForeignRuntimeResumeCoordinator {
  return createForeignRuntimeResumeCoordinator({
    adapters: input.map,
    processes: input.processes ?? new ScriptedChildProcesses(),
    clock: input.clock ?? new ManualClock(1_000_000),
    slots: input.slots ?? new IdentitySlot(),
    briefs: input.briefs ?? new IdentityBriefCompiler(),
    ...(input.resumeTimeoutMs !== undefined ? { resumeTimeoutMs: input.resumeTimeoutMs } : {}),
    ...(input.store ? { store: input.store } : {}),
  });
}

class IdentitySlot implements WorktreeSlotPort {
  readonly resets: string[] = [];
  reset(slotId: string): void {
    this.resets.push(slotId);
  }
}

class MarkingCompiler implements BriefCompilerPort {
  calls = 0;
  compile(next: CompiledBrief): CompiledBrief {
    this.calls += 1;
    return { ...next, text: `${next.text}\ncompiled-brief` };
  }
}

async function seed(
  coordinator: ForeignRuntimeResumeCoordinator,
  repo: string,
  pid: number,
  patch: Partial<PersistInput> = {},
): Promise<ForeignRuntimeCheckpoint> {
  const base = commitFile(repo, "keep.ts", "export const header = true\n", "base");
  const input: PersistInput = {
    attemptId: "attempt-1",
    adapterId: "codex",
    adapterVersion: "1.2.3",
    nativeSessionId: "thread-77",
    pinnedBaseCommitSha: base,
    pinnedSliceSha256: "slice-1",
    repoPath: repo,
    slotId: "slot-1",
    reason: "turn_completed",
    lastStepSummary: "paused after the last turn",
    briefText: "Use REST for orders",
    requirements: ["orders endpoint"],
    childPid: pid,
    residentRamMb: 280,
    contextUtilization: 0.2,
    ...patch,
  };
  return coordinator.persist(input);
}

describe("foreign runtime resume coordinator", { timeout: 60_000 }, () => {
  it("native-resumes identical and additive deltas and keeps the temp index off the real index", async () => {
    const repo = repoPath();
    const clock = new ManualClock(1_000_000);
    const procs = new ScriptedChildProcesses();
    const bundle = adapters();
    const coordinator = coordinatorFor({ map: bundle.map, clock, processes: procs });
    const pid = procs.spawn("codex").pid;
    writeFileSync(path.join(repo, "orders.ts"), "export const orders = 1\n");
    const saved = await seed(coordinator, repo, pid);
    const before = indexSha256(repo);
    writeFileSync(path.join(repo, "extra.ts"), "export const extra = 1\n");
    const again = await coordinator.persist({
      attemptId: "attempt-1",
      adapterId: "codex",
      adapterVersion: "1.2.3",
      nativeSessionId: "thread-77",
      pinnedBaseCommitSha: saved.pinnedBaseCommitSha,
      pinnedSliceSha256: "slice-1",
      repoPath: repo,
      slotId: "slot-1",
      reason: "turn_completed",
      lastStepSummary: "added extra",
      briefText: "Use REST for orders",
      requirements: ["orders endpoint"],
      childPid: pid,
      residentRamMb: 280,
    });
    expect(indexSha256(repo)).toBe(before);
    expect(again.modifiedFiles).toContain("extra.ts");
    expect(saved.wipTreeSha).toMatch(/^[0-9a-f]{40}$/);
    expect(saved.modifiedFiles).toContain("orders.ts");
    expect(saved.adapterId).toBe("codex");
    expect(saved.nativeSessionId).toBe("thread-77");
    expect(saved.pinnedSliceSha256).toBe("slice-1");

    const same = await coordinator.resume({
      attemptId: "attempt-1",
      slotPath: path.join(repo, "..", "slot-same"),
      brief: brief({
        text: "Use REST for orders",
        sliceSha256: "slice-1",
        requirements: ["orders endpoint"],
        changeKind: "none",
      }),
    });
    expect(same.strategy).toBe("native_resume");
    expect(same.timelineMessage).toBe("Resumed cleanly via native thread/resume");
    expect(bundle.codex.resumeCalls).toBe(1);
    expect(bundle.codex.lastResume?.nativeSessionId).toBe("thread-77");
    expect(bundle.codex.lastResume?.checkpointRef).toBe(again.wipTreeSha);
    expect(coordinator.timeline("attempt-1").map((entry) => entry.message)).toContain(
      "Resumed cleanly via native thread/resume",
    );

    const added = await coordinator.resume({
      attemptId: "attempt-1",
      slotPath: path.join(repo, "..", "slot-add"),
      brief: brief({
        text: "Use REST for orders\nalso add an aria-label",
        sliceSha256: "slice-2",
        requirements: ["orders endpoint", "aria-label"],
        changeKind: "additive",
        deltaNote: "also add an aria-label",
      }),
    });
    expect(added.strategy).toBe("native_resume");
    expect(bundle.codex.resumeCalls).toBe(2);
    expect(added.wipTreeSha).toBe(again.wipTreeSha);
  });

  it("rebuilds a labeled fresh session for contradictory deltas, version skew, context, and resume failure", async () => {
    const repo = repoPath();
    const procs = new ScriptedChildProcesses();
    const bundle = adapters();
    const briefs = new MarkingCompiler();
    const coordinator = coordinatorFor({ map: bundle.map, processes: procs, briefs });
    const pid = procs.spawn("codex").pid;
    writeFileSync(path.join(repo, "orders.ts"), "export const client = 'REST'\n");
    writeFileSync(path.join(repo, "notes.ts"), "export const note = 1\n");
    const saved = await seed(coordinator, repo, pid, { lastVerificationError: "typecheck failed on orders" });
    const slot = path.join(repo, "..", "slot-contradict");
    const rebuilt = await coordinator.resume({
      attemptId: "attempt-1",
      slotPath: slot,
      deltaType: "contradictory",
      brief: brief({
        text: "Switch from REST to GraphQL",
        sliceSha256: "slice-graphql",
        requirements: ["graphql endpoint"],
        changeKind: "contradictory",
        deltaNote: "Switch from REST to GraphQL",
        contradictedTokens: ["REST"],
      }),
    });
    expect(bundle.codex.resumeCalls).toBe(0);
    expect(rebuilt.strategy).toBe("fresh_session");
    expect(rebuilt.wipTreeSha).toBe(saved.wipTreeSha);
    expect(rebuilt.handoff).toContain(PRIOR_UNVERIFIED_WIP);
    expect(rebuilt.handoff).toContain(PRIOR_UNVERIFIED_WIP_HEADER);
    expect(rebuilt.handoff).toContain("Last failing check: typecheck failed on orders");
    expect(rebuilt.handoff).not.toContain("export const client");
    expect(rebuilt.tokenCount).toBeLessThanOrEqual(WIP_HANDOFF_TOKEN_LIMIT);
    expect(rebuilt.tokenCount).toBe(estimateTokens(rebuilt.handoff ?? ""));
    expect(rebuilt.wipedPaths).toContain("orders.ts");
    expect(rebuilt.keptPaths).toContain("notes.ts");
    expect(slotExists(slot, "notes.ts")).toBe(true);
    expect(slotExists(slot, "orders.ts")).toBe(false);
    expect(readSlot(slot, "keep.ts")).toContain("header");
    expect(briefs.calls).toBe(1);
    expect(bundle.codex.started[0]?.brief.text).toContain("GraphQL");
    expect(bundle.codex.started[0]?.brief.text).toContain("compiled-brief");

    bundle.map.set("codex", new FakeAdapter("codex", "2.0.0"));
    const skewed = coordinatorFor({
      map: bundle.map,
      processes: procs,
      store: coordinator.store as SqliteAttemptCheckpointStore,
    });
    const versionSlot = path.join(repo, "..", "slot-version");
    const versioned = await skewed.resume({
      attemptId: "attempt-1",
      slotPath: versionSlot,
      brief: brief({
        text: "Switch from REST to GraphQL",
        sliceSha256: "slice-graphql",
        requirements: ["graphql endpoint"],
        changeKind: "none",
      }),
    });
    expect(versioned.strategy).toBe("fresh_session");
    expect(versioned.disableNativeResumeForAttempt).toBe(true);
    const upgraded = bundle.map.get("codex");
    expect(upgraded?.resumeCalls).toBe(0);

    const failing = new FakeAdapter("codex", "1.2.3");
    failing.resumeResult = {
      ok: false,
      code: "incompatible",
      message: "Session format incompatible",
    };
    const failMap = new Map(bundle.map);
    failMap.set("codex", failing);
    const store = new SqliteAttemptCheckpointStore();
    const failingCoordinator = coordinatorFor({ map: failMap, processes: new ScriptedChildProcesses(), store });
    const failPid = 50;
    await seed(failingCoordinator, repoPath(), failPid);
    const first = await failingCoordinator.resume({
      attemptId: "attempt-1",
      slotPath: path.join(repo, "..", "slot-fail"),
      brief: brief({
        text: "Use REST for orders",
        sliceSha256: "slice-1",
        requirements: ["orders endpoint"],
      }),
    });
    expect(first.strategy).toBe("fresh_session");
    expect(first.resumeFailCount).toBe(1);
    expect(first.disableNativeResumeForAttempt).toBe(true);
    expect(first.handoff).toContain(PRIOR_UNVERIFIED_WIP);
    expect(failing.resumeCalls).toBe(1);
    const second = await failingCoordinator.resume({
      attemptId: "attempt-1",
      slotPath: path.join(repo, "..", "slot-fail-2"),
      brief: brief({
        text: "Use REST for orders",
        sliceSha256: "slice-1",
        requirements: ["orders endpoint"],
      }),
    });
    const third = await failingCoordinator.resume({
      attemptId: "attempt-1",
      slotPath: path.join(repo, "..", "slot-fail-3"),
      brief: brief({
        text: "Use REST for orders",
        sliceSha256: "slice-1",
        requirements: ["orders endpoint"],
      }),
    });
    expect(second.strategy).toBe("fresh_session");
    expect(third.strategy).toBe("fresh_session");
    expect(failing.resumeCalls).toBe(1);

    const hot = new FakeAdapter("codex", "1.2.3");
    const hotMap = new Map<string, FakeAdapter>([["codex", hot]]);
    const hotCoordinator = coordinatorFor({ map: hotMap, processes: new ScriptedChildProcesses() });
    await seed(hotCoordinator, repoPath(), 60, { contextUtilization: 0.8 });
    const atCeiling = await hotCoordinator.resume({
      attemptId: "attempt-1",
      slotPath: path.join(repo, "..", "slot-80"),
      contextUtilization: 0.8,
      brief: brief({
        text: "Use REST for orders",
        sliceSha256: "slice-1",
        requirements: ["orders endpoint"],
      }),
    });
    expect(atCeiling.strategy).toBe("native_resume");
    const over = await hotCoordinator.resume({
      attemptId: "attempt-1",
      slotPath: path.join(repo, "..", "slot-81"),
      contextUtilization: 0.81,
      brief: brief({
        text: "Use REST for orders",
        sliceSha256: "slice-1",
        requirements: ["orders endpoint"],
      }),
    });
    expect(over.strategy).toBe("fresh_session");
    expect(over.handoff).toContain(PRIOR_UNVERIFIED_WIP);
    expect(hot.resumeCalls).toBe(1);
  });

  it("hands a Codex checkpoint to Claude, OpenCode, Copilot, Cursor, and the native loop", async () => {
    const repo = repoPath();
    const procs = new ScriptedChildProcesses();
    const bundle = adapters();
    const coordinator = coordinatorFor({ map: bundle.map, processes: procs });
    const pid = procs.spawn("codex").pid;
    writeFileSync(path.join(repo, "orders.ts"), "export const orders = 1\n");
    const saved = await seed(coordinator, repo, pid, { reason: "pause", lastVerificationError: "allowance 90%" });
    const targets = [bundle.claude, bundle.opencode, bundle.copilot, bundle.cursor, bundle.native];
    let previousTree = saved.wipTreeSha;
    for (const target of targets) {
      const slot = path.join(repo, "..", `slot-${target.adapterId}`);
      const outcome = await coordinator.switchConnection(
        "attempt-1",
        target.adapterId,
        brief({
          text: "Use REST for orders",
          sliceSha256: "slice-1",
          requirements: ["orders endpoint"],
        }),
        slot,
      );
      expect(outcome.strategy).toBe("fresh_session");
      expect(outcome.adapterId).toBe(target.adapterId);
      expect(outcome.wipTreeSha).toBe(previousTree);
      expect(outcome.handoff).toContain(PRIOR_UNVERIFIED_WIP);
      expect(readSlot(slot, "orders.ts")).toContain("orders");
      expect(target.started[0]?.wipTreeSha).toBe(saved.wipTreeSha);
      expect(target.started[0]?.brief.text).toContain("Use REST for orders");
      previousTree = outcome.wipTreeSha;
    }
    expect(bundle.codex.resumeCalls).toBe(0);
    expect(coordinator.timeline("attempt-1").map((entry) => entry.message)).toContain(
      "Switched to fresh Claude Code session with labeled WIP diff",
    );
  });

  it("summarizes a 2 MB generated file inside the 1,500 token handoff", async () => {
    const repo = repoPath();
    const procs = new ScriptedChildProcesses();
    const bundle = adapters();
    const coordinator = coordinatorFor({ map: bundle.map, processes: procs });
    const pid = procs.spawn("codex").pid;
    writeFileSync(path.join(repo, "generated.ts"), "a".repeat(LARGE_WIP_FILE_BYTES));
    for (let index = 0; index < 30; index += 1) {
      writeFileSync(path.join(repo, `piece-${index}.ts`), `export const piece${index} = ${"x".repeat(180)}\n`);
    }
    await seed(coordinator, repo, pid, { lastVerificationError: "lint failed on generated.ts" });
    const outcome = await coordinator.switchConnection(
      "attempt-1",
      "claude-code",
      brief({
        text: "Use REST for orders",
        sliceSha256: "slice-1",
        requirements: ["orders endpoint"],
      }),
      path.join(repo, "..", "slot-large"),
    );
    expect(outcome.tokenCount).toBeLessThanOrEqual(WIP_HANDOFF_TOKEN_LIMIT);
    expect(outcome.handoff).toContain("generated.ts");
    expect(outcome.handoff).toContain("bytes");
    expect(outcome.handoff).not.toContain("a".repeat(80));
    expect(outcome.handoff).toContain("Last failing check: lint failed on generated.ts");
    expect(outcome.handoff).toContain(PRIOR_UNVERIFIED_WIP_HEADER);
  });

  it("parks at 90s, evicts immediately for the session cap, and serializes park versus wake", async () => {
    const repo = repoPath();
    const clock = new ManualClock(5_000_000);
    const os = new OsChildProcesses();
    processes.push(os);
    const bundle = adapters();
    const coordinator = coordinatorFor({ map: bundle.map, clock, processes: os });
    const pid = os.spawn("codex").pid;
    await seed(coordinator, repo, pid, { nativeSessionId: "thread-77", residentRamMb: 260 });
    writeFileSync(path.join(repo, "during-wait.ts"), "export const waited = true\n");
    coordinator.markIdle("attempt-1", "inbox");
    clock.advance(IDLE_PARK_AFTER_MS - 1);
    expect(await coordinator.sweepIdle()).toEqual([]);
    expect(os.isAlive(pid)).toBe(true);
    clock.advance(1);
    const parked = await coordinator.sweepIdle();
    expect(parked).toHaveLength(1);
    expect(parked[0]?.reclaimedRamMb).toBe(260);
    expect(os.isAlive(pid)).toBe(false);
    const stored = coordinator.store.get("attempt-1");
    expect(stored?.nativeSessionId).toBe("thread-77");
    expect(stored?.wipTreeSha).toMatch(/^[0-9a-f]{40}$/);
    expect(stored?.modifiedFiles).toContain("during-wait.ts");
    expect(stored?.parkReason).toBe("idle_park");
    const woke = await coordinator.wake("attempt-1", "the inbox answer", path.join(repo, "..", "slot-wake"));
    expect(woke.strategy).toBe("native_resume");
    expect(woke.timelineMessage).toBe("Resumed cleanly via native thread/resume");
    expect(bundle.codex.lastResume?.nativeSessionId).toBe("thread-77");
    expect(bundle.codex.steered.map((item) => item.note)).toContain("the inbox answer");

    const capRepo = repoPath();
    const capClock = new ManualClock(10_000);
    const capProcs = new ScriptedChildProcesses();
    const capBundle = adapters();
    const cap = coordinatorFor({ map: capBundle.map, clock: capClock, processes: capProcs });
    const capPid = capProcs.spawn("codex").pid;
    await seed(cap, capRepo, capPid, { residentRamMb: 280, attemptId: "attempt-1" });
    cap.markIdle("attempt-1", "allowance_reset");
    capClock.advance(1_000);
    const evicted = await cap.evictForCapacity({
      sessionId: "attempt-1",
      runtime: "codex",
      residentRamMb: 280,
      idleMs: 1_000,
      reason: "session_process_cap",
    });
    expect(evicted.reclaimedRamMb).toBe(280);
    expect(capProcs.isAlive(capPid)).toBe(false);
    expect(cap.timeline("attempt-1").map((entry) => entry.message)).toContain(
      "Auto-parked idle Codex process (freed 280 MB RAM)",
    );

    const raceRepo = repoPath();
    const raceClock = new ManualClock(20_000);
    const raceProcs = new ScriptedChildProcesses();
    const raceBundle = adapters();
    const race = coordinatorFor({ map: raceBundle.map, clock: raceClock, processes: raceProcs });
    const racePid = raceProcs.spawn("codex").pid;
    await seed(race, raceRepo, racePid);
    race.markIdle("attempt-1", "waiting_on_user");
    const liveWake = race.wake("attempt-1", "answer arrived", path.join(raceRepo, "..", "slot-race-live"));
    raceClock.advance(IDLE_PARK_AFTER_MS);
    const latePark = race.sweepIdle();
    await Promise.all([liveWake, latePark]);
    expect(raceProcs.writes.map((item) => item.pid)).toContain(racePid);
    expect(raceProcs.killed).not.toContain(racePid);

    const raceRepoB = repoPath();
    const raceClockB = new ManualClock(30_000);
    const raceProcsB = new ScriptedChildProcesses();
    const raceBundleB = adapters();
    const raceB = coordinatorFor({ map: raceBundleB.map, clock: raceClockB, processes: raceProcsB });
    const racePidB = raceProcsB.spawn("codex").pid;
    await seed(raceB, raceRepoB, racePidB);
    raceB.markIdle("attempt-1", "waiting_on_user");
    raceClockB.advance(IDLE_PARK_AFTER_MS);
    const parkFirst = raceB.sweepIdle();
    const wakeSecond = raceB.wake("attempt-1", "answer after park", path.join(raceRepoB, "..", "slot-race-park"));
    await Promise.all([parkFirst, wakeSecond]);
    expect(raceProcsB.killed).toContain(racePidB);
    expect(raceProcsB.writes.map((item) => item.pid)).not.toContain(racePidB);
    expect(raceBundleB.codex.resumeCalls).toBe(1);
  });

  it("salvages a SIGKILL crash before the worktree slot is reset", async () => {
    const repo = repoPath();
    const bundle = adapters();
    const seen: string[] = [];
    let coordinator: ForeignRuntimeResumeCoordinator | null = null;
    const slot: WorktreeSlotPort = {
      reset(slotId: string) {
        seen.push(`reset:${slotId}`);
        const tree = coordinator?.store.get("attempt-crash")?.wipTreeSha ?? null;
        seen.push(`tree:${tree ?? "missing"}`);
        for (const file of ["one.ts", "two.ts", "three.ts"]) {
          rmSync(path.join(repo, file), { force: true });
        }
      },
    };
    coordinator = coordinatorFor({ map: bundle.map, slots: slot });
    const base = commitFile(repo, "keep.ts", "export const header = true\n", "base");
    writeFileSync(path.join(repo, "one.ts"), "export const one = 1\n");
    writeFileSync(path.join(repo, "two.ts"), "export const two = 2\n");
    writeFileSync(path.join(repo, "three.ts"), "export const three = 3\n");
    const crash: CrashInput = {
      attemptId: "attempt-crash",
      adapterId: "codex",
      adapterVersion: "1.2.3",
      nativeSessionId: "thread-crash",
      pinnedBaseCommitSha: base,
      pinnedSliceSha256: "slice-crash",
      repoPath: repo,
      slotId: "slot-crash",
      briefText: "finish four files",
      requirements: ["four files"],
      signal: "SIGKILL",
      exitCode: 137,
      childPid: 137,
    };
    const saved = await coordinator.onChildCrash(crash);
    expect(seen[0]).toBe("reset:slot-crash");
    expect(seen[1]).toBe(`tree:${saved.wipTreeSha}`);
    expect(existsSync(path.join(repo, "one.ts"))).toBe(false);
    const names = new LocalGitTreeSafety().lsTree(repo, saved.wipTreeSha);
    expect(names).toEqual(expect.arrayContaining(["one.ts", "two.ts", "three.ts", "keep.ts"]));
    expect(names).not.toContain("four.ts");
    expect(saved.parkReason).toBe("crash");
    expect(saved.modifiedFiles).toEqual(expect.arrayContaining(["one.ts", "two.ts", "three.ts"]));
  });

  it("rejects a missing tree and rebases or falls back when integration moves", async () => {
    const repo = repoPath();
    const procs = new ScriptedChildProcesses();
    const bundle = adapters();
    const coordinator = coordinatorFor({ map: bundle.map, processes: procs });
    const pid = procs.spawn("codex").pid;
    const saved = await seed(coordinator, repo, pid);
    writeFileSync(path.join(repo, "feature.ts"), "export const feature = true\n");
    await coordinator.persist({
      attemptId: "attempt-1",
      adapterId: "codex",
      adapterVersion: "1.2.3",
      nativeSessionId: "thread-77",
      pinnedBaseCommitSha: saved.pinnedBaseCommitSha,
      pinnedSliceSha256: "slice-1",
      repoPath: repo,
      slotId: "slot-1",
      reason: "pause",
      lastStepSummary: "added feature",
      briefText: "Use REST for orders",
      requirements: ["orders endpoint"],
      childPid: pid,
    });
    const withFeature = coordinator.store.get("attempt-1");
    expect(withFeature).not.toBeNull();
    rmSync(path.join(repo, "feature.ts"));
    commitFile(repo, "integration.ts", "export const integration = true\n", "integration moved");
    const advanced = await coordinator.switchConnection(
      "attempt-1",
      "claude-code",
      brief({
        text: "Use REST for orders",
        sliceSha256: "slice-1",
        requirements: ["orders endpoint"],
      }),
      path.join(repo, "..", "slot-advanced"),
    );
    expect(advanced.baseNote).toContain("harness/integration advanced");
    expect(advanced.restoredTreeSha).not.toBeNull();
    const names = new LocalGitTreeSafety().lsTree(repo, advanced.restoredTreeSha ?? "");
    expect(names).toEqual(expect.arrayContaining(["keep.ts", "feature.ts", "integration.ts"]));

    const conflictRepo = repoPath();
    const conflict = coordinatorFor({ map: adapters().map, processes: new ScriptedChildProcesses() });
    const conflictPid = 80;
    const conflictBase = await seed(conflict, conflictRepo, conflictPid);
    writeFileSync(path.join(conflictRepo, "keep.ts"), "export const header = 'wip'\n");
    await conflict.persist({
      attemptId: "attempt-1",
      adapterId: "codex",
      adapterVersion: "1.2.3",
      nativeSessionId: "thread-77",
      pinnedBaseCommitSha: conflictBase.pinnedBaseCommitSha,
      pinnedSliceSha256: "slice-1",
      repoPath: conflictRepo,
      slotId: "slot-1",
      reason: "pause",
      lastStepSummary: "edited keep",
      briefText: "Use REST for orders",
      requirements: ["orders endpoint"],
      childPid: conflictPid,
    });
    writeFileSync(path.join(conflictRepo, "keep.ts"), "export const header = 'integration'\n");
    commitFile(conflictRepo, "keep.ts", "export const header = 'integration'\n", "integration edit");
    const conflicted = await conflict.switchConnection(
      "attempt-1",
      "native-worker-loop",
      brief({
        text: "Use REST for orders",
        sliceSha256: "slice-1",
        requirements: ["orders endpoint"],
      }),
      path.join(conflictRepo, "..", "slot-conflict"),
    );
    expect(conflicted.baseNote).toContain("did not merge cleanly");
    expect(readSlot(path.join(conflictRepo, "..", "slot-conflict"), "keep.ts")).toContain("integration");

    const missing = coordinator.store.get("attempt-1");
    if (!missing) throw new Error("expected checkpoint");
    coordinator.store.save({ ...missing, wipTreeSha: "a".repeat(40) }, 1);
    const missingOutcome = await coordinator.switchConnection(
      "attempt-1",
      "copilot",
      brief({
        text: "Use REST for orders",
        sliceSha256: "slice-1",
        requirements: ["orders endpoint"],
      }),
      path.join(repo, "..", "slot-missing"),
    );
    expect(missingOutcome.baseNote).toContain("missing");
    expect(slotExists(path.join(repo, "..", "slot-missing"), "feature.ts")).toBe(false);
    expect(readSlot(path.join(repo, "..", "slot-missing"), "keep.ts")).toContain("header");
  });

  it("persists every control checkpoint atomically and keeps a failed write from tearing the row", async () => {
    const repo = repoPath();
    const store = new SqliteAttemptCheckpointStore();
    const coordinator = coordinatorFor({
      map: adapters().map,
      processes: new ScriptedChildProcesses(),
      store,
    });
    const reasons = ["stop", "pause", "hold", "budget_100", "token_refresh", "turn_completed"] as const;
    let saved = await seed(coordinator, repo, 90, { reason: "stop" });
    expect(saved.parkReason).toBe("stop");
    for (const reason of reasons.slice(1)) {
      saved = await coordinator.persist({
        attemptId: "attempt-1",
        adapterId: "codex",
        adapterVersion: "1.2.3",
        nativeSessionId: "thread-77",
        pinnedBaseCommitSha: saved.pinnedBaseCommitSha,
        pinnedSliceSha256: "slice-1",
        repoPath: repo,
        slotId: "slot-1",
        reason,
        lastStepSummary: reason,
        briefText: "Use REST for orders",
        requirements: ["orders endpoint"],
        childPid: 90,
        residentRamMb: 280,
      });
      expect(saved.parkReason).toBe(reason);
      expect(saved.wipTreeSha).toMatch(/^[0-9a-f]{40}$/);
    }
    const projection = store.projection("attempt-1");
    expect(projection?.wipRef).toBe(saved?.wipTreeSha);
    expect(projection?.sessionRef).toBe("thread-77");
    const current = store.get("attempt-1");
    if (!current || !saved) throw new Error("expected checkpoint");
    store.failNextTransaction();
    expect(() => store.save({ ...current, lastStepSummary: "torn" }, 5)).toThrow(/fault/);
    expect(store.get("attempt-1")?.lastStepSummary).toBe(current.lastStepSummary);
    expect(store.projection("attempt-1")?.step).toBe(current.step);
  });

  it("times out a hung native resume once and falls back without throwing", async () => {
    const repo = repoPath();
    const hung = new FakeAdapter("codex", "1.2.3");
    hung.hang = true;
    const map = new Map<string, FakeAdapter>([["codex", hung]]);
    const coordinator = coordinatorFor({
      map,
      processes: new ScriptedChildProcesses(),
      resumeTimeoutMs: 30,
    });
    await seed(coordinator, repo, 70);
    const slot = path.join(repo, "..", "slot-timeout");
    mkdirSync(slot, { recursive: true });
    const outcome = await coordinator.resume({
      attemptId: "attempt-1",
      slotPath: slot,
      brief: brief({
        text: "Use REST for orders",
        sliceSha256: "slice-1",
        requirements: ["orders endpoint"],
      }),
    });
    expect(outcome.strategy).toBe("fresh_session");
    expect(outcome.disableNativeResumeForAttempt).toBe(true);
    expect(outcome.resumeFailCount).toBe(1);
    expect(hung.resumeCalls).toBe(1);
  });
});
