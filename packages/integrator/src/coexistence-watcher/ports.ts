import type { ActiveCoexistenceState, LockfileIncludeChoice, OverlapChoice } from "./constants.js";

export interface ActiveTaskSnapshot {
  readonly taskId: string;
  readonly agentLabel: string;
  readonly state: ActiveCoexistenceState;
  readonly writeScope: readonly string[];
}

export interface ActiveTasksPort {
  listActive(): readonly ActiveTaskSnapshot[];
}

export interface HoldPlacement {
  readonly taskId: string;
  readonly holdId: string;
}

export interface TaskHoldsManagerPort {
  placeHold(taskId: string, reason: string, detail: string): HoldPlacement;
  releaseHold(holdId: string): void;
}

export interface OverlapCardPayload {
  readonly filePath: string;
  readonly taskId: string;
  readonly agentLabel: string;
  readonly choices: readonly OverlapChoice[];
}

export interface LockfileIncludeCardPayload {
  readonly files: readonly string[];
  readonly choices: readonly ["commit_and_include", "keep_separate"];
}

export interface BranchRewriteCardPayload {
  readonly devBranch: string;
  readonly oldHead: string;
  readonly newHead: string;
}

export interface BranchSwitchNotice {
  readonly previousBranch: string;
  readonly currentBranch: string;
}

export interface CoexistenceUiPort {
  showOverlapCard(payload: OverlapCardPayload): void;
  showLockfileIncludeCard(payload: LockfileIncludeCardPayload): void;
  showBranchRewriteCard(payload: BranchRewriteCardPayload): void;
  showBranchSwitchNotice(notice: BranchSwitchNotice): void;
}

export interface CoexistenceEventRecord {
  readonly id: string;
  readonly kind:
    | "overlap_decision"
    | "base_sync"
    | "lockfile_include"
    | "branch_switch"
    | "branch_rewrite_blocked";
  readonly payload: Record<string, unknown>;
  readonly createdAt: string;
}

export interface CoexistenceEventStorePort {
  append(event: Omit<CoexistenceEventRecord, "id" | "createdAt">): CoexistenceEventRecord;
  list(): readonly CoexistenceEventRecord[];
}

export interface BaseSyncMergeRequest {
  readonly devBranch: string;
  readonly oldIntegrationSha: string;
  readonly newDevHead: string;
  readonly mergeResultSha: string;
}

export interface BaseSyncPreFlight {
  readonly deletedDependencyPaths: readonly string[];
  readonly rewriteDetected: boolean;
  readonly fastForward: boolean;
}

export interface ProjectMergeQueuePort {
  enqueueBaseSync(request: BaseSyncMergeRequest): Promise<{ readonly mergedSha: string }>;
}

export interface SmartBranchFreshnessSyncPort {
  afterBaseSync(devBranch: string, mergedSha: string): Promise<void>;
}

export interface RefLeaseAndCasManagerPort {
  readRef(repoRoot: string, ref: string): string | null;
  advanceRefCas(repoRoot: string, ref: string, expected: string, next: string): boolean;
}

export interface HumanOwnedTransitionPort {
  transitionToHumanOwned(taskId: string, filePath: string): void;
}

export interface LandingOverlapFlagPort {
  flagKeepBoth(filePath: string, taskId: string): void;
}

/** In-memory stand-ins for unit tests and integration wiring. */

export class InMemoryActiveTasks implements ActiveTasksPort {
  private tasks: ActiveTaskSnapshot[] = [];

  setTasks(tasks: readonly ActiveTaskSnapshot[]): void {
    this.tasks = [...tasks];
  }

  listActive(): readonly ActiveTaskSnapshot[] {
    return this.tasks;
  }
}

export class InMemoryTaskHoldsManager implements TaskHoldsManagerPort {
  readonly holds: Array<{ taskId: string; reason: string; detail: string; holdId: string }> = [];
  private seq = 0;

  placeHold(taskId: string, reason: string, detail: string): HoldPlacement {
    const holdId = `hold-${++this.seq}`;
    this.holds.push({ taskId, reason, detail, holdId });
    return { taskId, holdId };
  }

  releaseHold(holdId: string): void {
    const index = this.holds.findIndex((h) => h.holdId === holdId);
    if (index >= 0) this.holds.splice(index, 1);
  }
}

export class RecordingCoexistenceUi implements CoexistenceUiPort {
  overlapCards: OverlapCardPayload[] = [];
  lockfileCards: LockfileIncludeCardPayload[] = [];
  rewriteCards: BranchRewriteCardPayload[] = [];
  branchNotices: BranchSwitchNotice[] = [];

  showOverlapCard(payload: OverlapCardPayload): void {
    this.overlapCards.push(payload);
  }

  showLockfileIncludeCard(payload: LockfileIncludeCardPayload): void {
    this.lockfileCards.push(payload);
  }

  showBranchRewriteCard(payload: BranchRewriteCardPayload): void {
    this.rewriteCards.push(payload);
  }

  showBranchSwitchNotice(notice: BranchSwitchNotice): void {
    this.branchNotices.push(notice);
  }
}

export class InMemoryCoexistenceEventStore implements CoexistenceEventStorePort {
  readonly events: CoexistenceEventRecord[] = [];
  private seq = 0;

  append(event: Omit<CoexistenceEventRecord, "id" | "createdAt">): CoexistenceEventRecord {
    const record: CoexistenceEventRecord = {
      ...event,
      id: `evt-${++this.seq}`,
      createdAt: new Date().toISOString(),
    };
    this.events.push(record);
    return record;
  }

  list(): readonly CoexistenceEventRecord[] {
    return this.events;
  }
}

export class InMemoryProjectMergeQueue implements ProjectMergeQueuePort {
  readonly requests: BaseSyncMergeRequest[] = [];

  async enqueueBaseSync(request: BaseSyncMergeRequest): Promise<{ readonly mergedSha: string }> {
    this.requests.push(request);
    return { mergedSha: request.mergeResultSha };
  }
}

export class NoopSmartBranchFreshnessSync implements SmartBranchFreshnessSyncPort {
  readonly calls: Array<{ devBranch: string; mergedSha: string }> = [];

  async afterBaseSync(devBranch: string, mergedSha: string): Promise<void> {
    this.calls.push({ devBranch, mergedSha });
  }
}

export class RecordingHumanOwnedTransition implements HumanOwnedTransitionPort {
  readonly transitions: Array<{ taskId: string; filePath: string }> = [];

  transitionToHumanOwned(taskId: string, filePath: string): void {
    this.transitions.push({ taskId, filePath });
  }
}

export class RecordingLandingOverlapFlag implements LandingOverlapFlagPort {
  readonly flags: Array<{ filePath: string; taskId: string }> = [];

  flagKeepBoth(filePath: string, taskId: string): void {
    this.flags.push({ filePath, taskId });
  }
}

export interface LockfileDecision {
  readonly choice: LockfileIncludeChoice;
  readonly files: readonly string[];
}