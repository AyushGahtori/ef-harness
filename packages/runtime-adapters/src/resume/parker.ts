import type { Clock } from "./clock.js";
import type { AttemptCheckpointStore } from "./checkpoint-store.js";
import { ResumeError } from "./errors.js";
import type { DirtySnapshotEngine } from "./git-work.js";
import type { ChildProcessPort } from "./ports.js";
import {
  IDLE_PARK_AFTER_MS,
  autoParkTimeline,
  type ForeignRuntimeCheckpoint,
  type IdleWaitKind,
  type ParkReason,
} from "./types.js";

/**
 * Task 119 `IdleWrappedAgentParkerPort` request.
 * `sessionId` is the attempt id or the native session id registered for that attempt.
 */
export interface ParkRequest {
  readonly sessionId: string;
  readonly runtime: string;
  readonly residentRamMb: number;
  readonly idleMs: number;
  readonly reason: "session_process_cap";
}

export interface ParkResult {
  readonly parked: true;
  readonly reclaimedRamMb: number;
}

interface TrackedSession {
  attemptId: string;
  adapterId: string;
  nativeSessionId: string | null;
  pid: number | null;
  residentRamMb: number;
  idleSince: number | null;
  idleKind: IdleWaitKind | null;
  parked: boolean;
}

/**
 * Checkpoints and terminates idle wrapped foreign CLI processes.
 * The 90-second sweep uses the injected clock. Cap pressure parks immediately.
 */
export class IdleWrappedAgentAutoParker {
  private readonly byKey = new Map<string, TrackedSession>();

  constructor(
    private readonly store: AttemptCheckpointStore,
    private readonly snapshots: DirtySnapshotEngine,
    private readonly processes: ChildProcessPort,
    private readonly clock: Clock,
  ) {}

  observe(checkpoint: ForeignRuntimeCheckpoint): void {
    const existing = this.byKey.get(checkpoint.attemptId);
    const tracked: TrackedSession = existing ?? {
      attemptId: checkpoint.attemptId,
      adapterId: checkpoint.adapterId,
      nativeSessionId: checkpoint.nativeSessionId,
      pid: checkpoint.childPid,
      residentRamMb: checkpoint.residentRamMb,
      idleSince: checkpoint.idleSince,
      idleKind: checkpoint.idleKind,
      parked: !checkpoint.processAlive,
    };
    tracked.adapterId = checkpoint.adapterId;
    tracked.nativeSessionId = checkpoint.nativeSessionId;
    tracked.pid = checkpoint.childPid;
    tracked.residentRamMb = checkpoint.residentRamMb;
    tracked.idleSince = checkpoint.idleSince;
    tracked.idleKind = checkpoint.idleKind;
    tracked.parked = !checkpoint.processAlive;
    this.byKey.set(checkpoint.attemptId, tracked);
    if (checkpoint.nativeSessionId) this.byKey.set(checkpoint.nativeSessionId, tracked);
  }

  markIdle(attemptId: string, kind: IdleWaitKind, at: number): void {
    const tracked = this.require(attemptId);
    if (tracked.idleSince === null) tracked.idleSince = at;
    tracked.idleKind = kind;
    const record = this.store.get(tracked.attemptId);
    if (!record) return;
    this.store.save(
      { ...record, idleSince: tracked.idleSince, idleKind: kind },
      at,
    );
  }

  markBusy(attemptId: string, at: number): void {
    const tracked = this.require(attemptId);
    tracked.idleSince = null;
    tracked.idleKind = null;
    tracked.parked = false;
    const record = this.store.get(tracked.attemptId);
    if (!record) return;
    this.store.save({ ...record, idleSince: null, idleKind: null }, at);
  }

  isWaiting(sessionId: string): boolean {
    const tracked = this.byKey.get(sessionId);
    return tracked !== undefined && !tracked.parked && tracked.idleKind !== null && tracked.idleSince !== null;
  }

  idleLongEnough(sessionId: string, now: number): boolean {
    const tracked = this.byKey.get(sessionId);
    if (!tracked || tracked.parked || tracked.idleSince === null || tracked.idleKind === null) return false;
    return now - tracked.idleSince >= IDLE_PARK_AFTER_MS;
  }

  due(now: number): readonly string[] {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const tracked of this.byKey.values()) {
      if (seen.has(tracked.attemptId)) continue;
      seen.add(tracked.attemptId);
      if (this.idleLongEnough(tracked.attemptId, now)) ids.push(tracked.attemptId);
    }
    return ids;
  }

  /** Immediate park used by Task 119 `SessionProcessCapGuard` when it needs a slot. */
  checkpointAndPark(request: ParkRequest): ParkResult {
    return this.park(request.sessionId, "session_process_cap", request.residentRamMb);
  }

  park(sessionId: string, reason: ParkReason, residentRamMb?: number): ParkResult {
    const tracked = this.require(sessionId);
    if (tracked.parked) return { parked: true, reclaimedRamMb: 0 };
    const record = this.store.get(tracked.attemptId);
    if (!record) {
      throw new ResumeError("missing_checkpoint", `No checkpoint to park for ${tracked.attemptId}`);
    }
    const snapshot = this.snapshots.capture(record.worktreePath);
    const ram = residentRamMb ?? tracked.residentRamMb;
    const pid = tracked.pid;
    const at = this.clock.now();
    const next: ForeignRuntimeCheckpoint = {
      ...record,
      wipTreeSha: snapshot.treeSha,
      modifiedFiles: snapshot.modifiedFiles,
      parkedAt: at,
      parkReason: reason,
      step: record.step + 1,
      processAlive: false,
      childPid: null,
      residentRamMb: ram,
      idleKind: tracked.idleKind,
      idleSince: tracked.idleSince,
      timeline: [...record.timeline, { at, message: autoParkTimeline(tracked.adapterId, ram) }],
    };
    this.store.save(next, at);
    if (pid !== null && this.processes.isAlive(pid)) this.processes.kill(pid);
    tracked.parked = true;
    tracked.pid = null;
    return { parked: true, reclaimedRamMb: ram };
  }

  private require(sessionId: string): TrackedSession {
    const tracked = this.byKey.get(sessionId);
    if (!tracked) throw new ResumeError("missing_session", `No wrapped session registered for ${sessionId}`);
    return tracked;
  }
}
