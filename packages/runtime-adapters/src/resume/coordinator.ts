import { capacityPools } from "@ef-harness/governor";
import type { Clock } from "./clock.js";
import { SystemClock } from "./clock.js";
import type { AttemptCheckpointStore } from "./checkpoint-store.js";
import { SqliteAttemptCheckpointStore } from "./checkpoint-store.js";
import type { DeltaInspection } from "./delta.js";
import { ResumeError } from "./errors.js";
import { GitEngineDirtySnapshot, LocalGitTreeSafety } from "./git-work.js";
import type { DirtySnapshot, DirtySnapshotEngine, GitTreeSafety } from "./git-work.js";
import { PlannerBriefCompiler, PooledWorktreeSlot, SteeringDeltaResumer } from "./live-ports.js";
import { AttemptMutex } from "./mutex.js";
import { IdleWrappedAgentAutoParker } from "./parker.js";
import type { ParkRequest, ParkResult } from "./parker.js";
import { versionsCompatible } from "./ports.js";
import type {
  BriefCompilerPort,
  ChildProcessPort,
  ForeignAdapterPort,
  ResumeCallResult,
  WorktreeSlotPort,
} from "./ports.js";
import { LabeledWipFreshSessionRebuilder } from "./rebuilder.js";
import {
  CONTEXT_FRESH_SESSION_ABOVE,
  nativeResumeTimeline,
  type CompiledBrief,
  type DeltaKind,
  type ForeignRuntimeCheckpoint,
  type IdleWaitKind,
  type ParkReason,
  type ResumeOutcome,
  type TimelineEntry,
} from "./types.js";

const DEFAULT_RESUME_TIMEOUT_MS = 15_000;

export interface PersistInput {
  readonly attemptId: string;
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly nativeSessionId: string | null;
  readonly pinnedBaseCommitSha: string;
  readonly pinnedSliceSha256: string;
  readonly repoPath: string;
  readonly slotId: string;
  readonly reason: ParkReason;
  readonly lastStepSummary: string;
  readonly briefText: string;
  readonly requirements: readonly string[];
  readonly lastVerificationError?: string | null;
  readonly contextUtilization?: number;
  readonly residentRamMb?: number;
  readonly childPid?: number | null;
}

export interface ResumeRequest {
  readonly attemptId: string;
  readonly brief: CompiledBrief;
  readonly slotPath: string;
  readonly deltaType?: DeltaKind;
  readonly targetAdapterId?: string;
  readonly contextUtilization?: number;
  readonly answer?: string;
}

export interface CrashInput {
  readonly attemptId: string;
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly nativeSessionId: string | null;
  readonly pinnedBaseCommitSha: string;
  readonly pinnedSliceSha256: string;
  readonly repoPath: string;
  readonly slotId: string;
  readonly briefText: string;
  readonly requirements: readonly string[];
  readonly signal: "SIGKILL" | "SIGTERM";
  readonly exitCode: number;
  readonly childPid: number | null;
  readonly residentRamMb?: number;
  readonly lastStepSummary?: string;
}

export interface CoordinatorOptions {
  readonly adapters: ReadonlyMap<string, ForeignAdapterPort>;
  readonly store?: AttemptCheckpointStore;
  readonly snapshots?: DirtySnapshotEngine;
  readonly trees?: GitTreeSafety;
  readonly rebuilder?: LabeledWipFreshSessionRebuilder;
  readonly parker?: IdleWrappedAgentAutoParker;
  readonly processes: ChildProcessPort;
  readonly clock?: Clock;
  readonly slots?: WorktreeSlotPort;
  readonly briefs?: BriefCompilerPort;
  readonly delta?: { inspect(pinned: { readonly sliceSha256: string; readonly briefText: string; readonly requirements: readonly string[] }, next: CompiledBrief): DeltaInspection };
  readonly mutex?: AttemptMutex;
  readonly resumeTimeoutMs?: number;
}

/**
 * Decides native resume versus a labeled fresh session, and owns park/wake serialization.
 */
export class ForeignRuntimeResumeCoordinator {
  readonly store: AttemptCheckpointStore;
  readonly parker: IdleWrappedAgentAutoParker;
  readonly rebuilder: LabeledWipFreshSessionRebuilder;
  private readonly snapshots: DirtySnapshotEngine;
  private readonly delta: { inspect(pinned: { readonly sliceSha256: string; readonly briefText: string; readonly requirements: readonly string[] }, next: CompiledBrief): DeltaInspection };
  private readonly sessionCaps: capacityPools.SessionProcessCapGuard;
  private readonly processes: ChildProcessPort;
  private readonly adapters: ReadonlyMap<string, ForeignAdapterPort>;
  private readonly clock: Clock;
  private readonly slots: WorktreeSlotPort;
  private readonly mutex: AttemptMutex;
  private readonly resumeTimeoutMs: number;

  constructor(options: CoordinatorOptions) {
    this.adapters = options.adapters;
    this.processes = options.processes;
    this.clock = options.clock ?? new SystemClock();
    this.slots = options.slots ?? new PooledWorktreeSlot();
    this.store = options.store ?? new SqliteAttemptCheckpointStore();
    this.snapshots = options.snapshots ?? new GitEngineDirtySnapshot();
    const trees = options.trees ?? new LocalGitTreeSafety();
    const briefs = options.briefs ?? new PlannerBriefCompiler();
    this.rebuilder = options.rebuilder ?? new LabeledWipFreshSessionRebuilder(trees, briefs);
    this.parker =
      options.parker ??
      new IdleWrappedAgentAutoParker(this.store, this.snapshots, this.processes, this.clock);
    this.delta = options.delta ?? new SteeringDeltaResumer();
    this.sessionCaps = new capacityPools.SessionProcessCapGuard(this.clock, capacityPools.defaultSessionProcessCap(16), {
      checkpointAndPark: (request) => this.parker.checkpointAndPark(request),
    });
    this.mutex = options.mutex ?? new AttemptMutex();
    this.resumeTimeoutMs = options.resumeTimeoutMs ?? DEFAULT_RESUME_TIMEOUT_MS;
  }

  async persist(input: PersistInput): Promise<ForeignRuntimeCheckpoint> {
    return this.mutex.run(input.attemptId, () => this.persistUnlocked(input));
  }

  async resume(input: ResumeRequest): Promise<ResumeOutcome> {
    return this.mutex.run(input.attemptId, () => this.resumeUnlocked(input));
  }

  async switchConnection(
    attemptId: string,
    targetAdapterId: string,
    brief: CompiledBrief,
    slotPath: string,
  ): Promise<ResumeOutcome> {
    return this.resume({ attemptId, brief, slotPath, targetAdapterId });
  }

  async sweepIdle(): Promise<readonly ParkResult[]> {
    const due = this.parker.due(this.clock.now());
    const parked: ParkResult[] = [];
    for (const attemptId of due) {
      const result = await this.mutex.run(attemptId, () => {
        if (!this.parker.idleLongEnough(attemptId, this.clock.now())) return null;
        return this.parker.park(attemptId, "idle_park");
      });
      if (result && result.reclaimedRamMb > 0) parked.push(result);
    }
    // SIGKILL is reported on a later timer turn. Wait so callers observe the exit.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });
    return parked;
  }

  /** Immediate eviction when `SessionProcessCapGuard` needs a resident slot. */
  async evictForCapacity(request: ParkRequest): Promise<ParkResult> {
    return this.mutex.run(request.sessionId, () => {
      if (this.sessionCaps.activeCount() > this.sessionCaps.cap) {
        return this.parker.checkpointAndPark(request);
      }
      if (!this.parker.isWaiting(request.sessionId)) return { parked: true, reclaimedRamMb: 0 };
      return this.parker.checkpointAndPark(request);
    });
  }

  checkpointAndPark(request: ParkRequest): ParkResult {
    return this.parker.checkpointAndPark(request);
  }

  async wake(attemptId: string, answer: string, slotPath: string): Promise<ResumeOutcome> {
    return this.mutex.run(attemptId, async () => {
      const checkpoint = this.require(attemptId);
      if (
        checkpoint.processAlive &&
        checkpoint.childPid !== null &&
        this.processes.isAlive(checkpoint.childPid)
      ) {
        this.processes.writeStdin(checkpoint.childPid, answer);
        this.parker.markBusy(attemptId, this.clock.now());
        const message = "Delivered the user answer to the live session";
        const next = this.withTimeline(checkpoint, message, {
          idleKind: null,
          idleSince: null,
        });
        this.store.save(next, this.clock.now());
        this.parker.observe(next);
        return outcomeFromLive(next, message);
      }
      return this.resumeUnlocked({
        attemptId,
        slotPath,
        answer,
        brief: {
          sliceSha256: checkpoint.pinnedSliceSha256,
          text: checkpoint.briefText,
          requirements: checkpoint.requirements,
          changeKind: "none",
          deltaNote: answer,
          contradictedTokens: [],
        },
      });
    });
  }

  async onChildCrash(input: CrashInput): Promise<ForeignRuntimeCheckpoint> {
    return this.mutex.run(input.attemptId, async () => {
      const snapshot = await readSnapshot(this.snapshots, input.repoPath);
      const previous = this.store.get(input.attemptId);
      const at = this.clock.now();
      const message = `Salvaged worktree edits after ${input.signal} exit ${input.exitCode} before slot reset`;
      const record: ForeignRuntimeCheckpoint = {
        attemptId: input.attemptId,
        adapterId: input.adapterId,
        adapterVersion: input.adapterVersion,
        nativeSessionId: input.nativeSessionId,
        pinnedBaseCommitSha: input.pinnedBaseCommitSha,
        pinnedSliceSha256: input.pinnedSliceSha256,
        wipTreeSha: snapshot.treeSha,
        modifiedFiles: snapshot.modifiedFiles,
        lastStepSummary: input.lastStepSummary ?? previous?.lastStepSummary ?? "child process crashed",
        lastVerificationError: previous?.lastVerificationError ?? null,
        parkedAt: at,
        parkReason: "crash",
        resumeFailCount: previous?.resumeFailCount ?? 0,
        disableNativeResumeForAttempt: previous?.disableNativeResumeForAttempt ?? false,
        contextUtilization: previous?.contextUtilization ?? 0,
        step: (previous?.step ?? 0) + 1,
        residentRamMb: input.residentRamMb ?? previous?.residentRamMb ?? 200,
        idleKind: null,
        idleSince: null,
        childPid: null,
        processAlive: false,
        briefText: input.briefText,
        requirements: input.requirements,
        timeline: [...(previous?.timeline ?? []), { at, message }],
        worktreePath: input.repoPath,
        slotId: input.slotId,
        lastHandoff: previous?.lastHandoff ?? null,
      };
      this.store.save(record, at);
      this.slots.reset(input.slotId);
      this.parker.observe(record);
      return record;
    });
  }

  markIdle(attemptId: string, kind: IdleWaitKind): void {
    this.parker.markIdle(attemptId, kind, this.clock.now());
  }

  timeline(attemptId: string): readonly TimelineEntry[] {
    return this.require(attemptId).timeline;
  }

  private async persistUnlocked(input: PersistInput): Promise<ForeignRuntimeCheckpoint> {
    const previous = this.store.get(input.attemptId);
    const snapshot = await readSnapshot(this.snapshots, input.repoPath);
    const at = this.clock.now();
    const requestedPid = input.childPid === undefined ? (previous?.childPid ?? null) : input.childPid;
    const processAlive = input.reason !== "crash" && requestedPid !== null;
    const record: ForeignRuntimeCheckpoint = {
      attemptId: input.attemptId,
      adapterId: input.adapterId,
      adapterVersion: input.adapterVersion,
      nativeSessionId: input.nativeSessionId,
      pinnedBaseCommitSha: input.pinnedBaseCommitSha,
      pinnedSliceSha256: input.pinnedSliceSha256,
      wipTreeSha: snapshot.treeSha,
      modifiedFiles: snapshot.modifiedFiles,
      lastStepSummary: input.lastStepSummary,
      lastVerificationError: input.lastVerificationError ?? previous?.lastVerificationError ?? null,
      parkedAt: input.reason === "turn_completed" ? null : at,
      parkReason: input.reason,
      resumeFailCount: previous?.resumeFailCount ?? 0,
      disableNativeResumeForAttempt: previous?.disableNativeResumeForAttempt ?? false,
      contextUtilization: input.contextUtilization ?? previous?.contextUtilization ?? 0,
      step: (previous?.step ?? 0) + 1,
      residentRamMb: input.residentRamMb ?? previous?.residentRamMb ?? 200,
      idleKind: previous?.idleKind ?? null,
      idleSince: previous?.idleSince ?? null,
      childPid: processAlive ? requestedPid : null,
      processAlive,
      briefText: input.briefText,
      requirements: input.requirements,
      timeline: previous?.timeline ?? [],
      worktreePath: input.repoPath,
      slotId: input.slotId,
      lastHandoff: previous?.lastHandoff ?? null,
    };
    this.store.save(record, at);
    this.parker.observe(record);
    return record;
  }

  private async resumeUnlocked(input: ResumeRequest): Promise<ResumeOutcome> {
    const checkpoint = this.require(input.attemptId);
    const targetId = input.targetAdapterId ?? checkpoint.adapterId;
    const switched = targetId !== checkpoint.adapterId;
    const adapter = this.adapter(targetId);
    const inspection = this.delta.inspect(
      {
        sliceSha256: checkpoint.pinnedSliceSha256,
        briefText: checkpoint.briefText,
        requirements: checkpoint.requirements,
      },
      input.brief,
    );
    const kind = input.deltaType ?? inspection.kind;
    const utilization = input.contextUtilization ?? checkpoint.contextUtilization;
    const versionOk = switched || versionsCompatible(checkpoint.adapterVersion, adapter.version);
    const nativeAllowed = this.nativeAllowed(checkpoint, adapter, kind, utilization, switched, versionOk);

    if (!versionOk && !switched) {
      return this.rebuild(checkpoint, input, adapter, kind, true, false);
    }
    if (!nativeAllowed) {
      return this.rebuild(
        checkpoint,
        input,
        adapter,
        kind,
        checkpoint.disableNativeResumeForAttempt,
        false,
      );
    }
    const nativeSessionId = checkpoint.nativeSessionId;
    if (nativeSessionId === null) {
      return this.rebuild(checkpoint, input, adapter, kind, false, false);
    }
    const spawned = this.processes.spawn(adapter.adapterId);
    const result = await this.callResume(adapter, nativeSessionId, checkpoint.wipTreeSha);
    if (!result.ok) {
      if (this.processes.isAlive(spawned.pid)) this.processes.kill(spawned.pid);
      return this.rebuild(checkpoint, input, adapter, kind, true, true);
    }
    const pid = result.pid ?? spawned.pid;
    if (result.pid !== undefined && result.pid !== spawned.pid && this.processes.isAlive(spawned.pid)) {
      this.processes.kill(spawned.pid);
    }
    if (input.answer && adapter.steer) await adapter.steer(result.sessionId, input.answer);
    const message = nativeResumeTimeline(adapter.adapterId);
    const next = this.withTimeline(checkpoint, message, {
      adapterId: adapter.adapterId,
      adapterVersion: adapter.version,
      nativeSessionId: result.sessionId,
      childPid: pid,
      processAlive: true,
      parkedAt: null,
      parkReason: null,
      idleKind: null,
      idleSince: null,
      pinnedSliceSha256: input.brief.sliceSha256,
      briefText: input.brief.text,
      requirements: input.brief.requirements,
    });
    this.store.save(next, this.clock.now());
    this.parker.observe(next);
    this.parker.markBusy(input.attemptId, this.clock.now());
    return {
      strategy: "native_resume",
      attemptId: next.attemptId,
      adapterId: next.adapterId,
      sessionId: result.sessionId,
      pid,
      wipTreeSha: next.wipTreeSha,
      restoredTreeSha: null,
      handoff: null,
      tokenCount: 0,
      timelineMessage: message,
      disableNativeResumeForAttempt: next.disableNativeResumeForAttempt,
      resumeFailCount: next.resumeFailCount,
      briefText: next.briefText,
      baseNote: null,
      wipedPaths: [],
      keptPaths: [],
    };
  }

  private nativeAllowed(
    checkpoint: ForeignRuntimeCheckpoint,
    adapter: ForeignAdapterPort,
    kind: DeltaKind,
    utilization: number,
    switched: boolean,
    versionOk: boolean,
  ): boolean {
    if (switched) return false;
    if (checkpoint.disableNativeResumeForAttempt) return false;
    if (!adapter.nativeResumeSupported) return false;
    if (!versionOk) return false;
    if (kind === "contradictory") return false;
    if (kind !== "none" && kind !== "additive") return false;
    if (utilization > CONTEXT_FRESH_SESSION_ABOVE) return false;
    if (checkpoint.nativeSessionId === null) return false;
    return true;
  }

  private async callResume(
    adapter: ForeignAdapterPort,
    nativeSessionId: string,
    checkpointRef: string,
  ): Promise<ResumeCallResult> {
    try {
      return await withTimeout(
        adapter.resume(nativeSessionId, checkpointRef),
        this.resumeTimeoutMs,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "native resume failed";
      const code = error instanceof ResumeError && error.code === "timeout" ? "timeout" : "failed";
      return { ok: false, code, message };
    }
  }

  private async rebuild(
    checkpoint: ForeignRuntimeCheckpoint,
    input: ResumeRequest,
    adapter: ForeignAdapterPort,
    kind: DeltaKind,
    disableNative: boolean,
    countFailure: boolean,
  ): Promise<ResumeOutcome> {
    const prepared: ForeignRuntimeCheckpoint = {
      ...checkpoint,
      disableNativeResumeForAttempt: disableNative || checkpoint.disableNativeResumeForAttempt,
      resumeFailCount: checkpoint.resumeFailCount + (countFailure ? 1 : 0),
    };
    const inspected = this.delta.inspect(
      {
        sliceSha256: checkpoint.pinnedSliceSha256,
        briefText: checkpoint.briefText,
        requirements: checkpoint.requirements,
      },
      input.brief,
    );
    const rebuilt = await this.rebuilder.rebuild({
      checkpoint: prepared,
      brief: input.brief,
      adapter,
      slotPath: input.slotPath,
      kind,
      contradictedTokens:
        kind === "contradictory" ? mergeTokens(input.brief.contradictedTokens, inspected.contradictedTokens) : [],
      switched: adapter.adapterId !== checkpoint.adapterId,
    });
    const next = this.withTimeline(prepared, rebuilt.timelineMessage, {
      adapterId: adapter.adapterId,
      adapterVersion: adapter.version,
      nativeSessionId: rebuilt.sessionId,
      childPid: rebuilt.pid,
      processAlive: true,
      parkedAt: null,
      parkReason: null,
      idleKind: null,
      idleSince: null,
      wipTreeSha: rebuilt.wipTreeSha,
      pinnedSliceSha256: rebuilt.brief.sliceSha256,
      briefText: rebuilt.brief.text,
      requirements: rebuilt.brief.requirements,
      lastHandoff: rebuilt.handoff,
    });
    this.store.save(next, this.clock.now());
    this.parker.observe(next);
    this.parker.markBusy(input.attemptId, this.clock.now());
    return {
      strategy: "fresh_session",
      attemptId: next.attemptId,
      adapterId: adapter.adapterId,
      sessionId: rebuilt.sessionId,
      pid: rebuilt.pid,
      wipTreeSha: rebuilt.wipTreeSha,
      restoredTreeSha: rebuilt.restoredTreeSha,
      handoff: rebuilt.handoff,
      tokenCount: rebuilt.tokens,
      timelineMessage: rebuilt.timelineMessage,
      disableNativeResumeForAttempt: next.disableNativeResumeForAttempt,
      resumeFailCount: next.resumeFailCount,
      briefText: next.briefText,
      baseNote: rebuilt.baseNote,
      wipedPaths: rebuilt.wipedPaths,
      keptPaths: rebuilt.keptPaths,
    };
  }

  private withTimeline(
    checkpoint: ForeignRuntimeCheckpoint,
    message: string,
    patch: Partial<ForeignRuntimeCheckpoint>,
  ): ForeignRuntimeCheckpoint {
    const at = this.clock.now();
    return {
      ...checkpoint,
      ...patch,
      step: checkpoint.step + 1,
      timeline: [...checkpoint.timeline, { at, message }],
    };
  }

  private require(attemptId: string): ForeignRuntimeCheckpoint {
    const record = this.store.get(attemptId);
    if (!record) throw new ResumeError("missing_checkpoint", `No checkpoint for ${attemptId}`);
    return record;
  }

  private adapter(adapterId: string): ForeignAdapterPort {
    const found = this.adapters.get(adapterId);
    if (!found) throw new ResumeError("adapter", `No adapter registered for ${adapterId}`);
    return found;
  }
}

function mergeTokens(left: readonly string[], right: readonly string[]): string[] {
  return [...new Set([...left, ...right])];
}

function outcomeFromLive(checkpoint: ForeignRuntimeCheckpoint, message: string): ResumeOutcome {
  return {
    strategy: "already_live",
    attemptId: checkpoint.attemptId,
    adapterId: checkpoint.adapterId,
    sessionId: checkpoint.nativeSessionId ?? checkpoint.attemptId,
    pid: checkpoint.childPid,
    wipTreeSha: checkpoint.wipTreeSha,
    restoredTreeSha: null,
    handoff: null,
    tokenCount: 0,
    timelineMessage: message,
    disableNativeResumeForAttempt: checkpoint.disableNativeResumeForAttempt,
    resumeFailCount: checkpoint.resumeFailCount,
    briefText: checkpoint.briefText,
    baseNote: null,
    wipedPaths: [],
    keptPaths: [],
  };
}

async function readSnapshot(engine: DirtySnapshotEngine, repoPath: string): Promise<DirtySnapshot> {
  if (engine instanceof GitEngineDirtySnapshot) return engine.captureCommitted(repoPath);
  return engine.capture(repoPath);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new ResumeError("timeout", "native resume timed out"));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function createForeignRuntimeResumeCoordinator(
  options: CoordinatorOptions,
): ForeignRuntimeResumeCoordinator {
  return new ForeignRuntimeResumeCoordinator(options);
}
