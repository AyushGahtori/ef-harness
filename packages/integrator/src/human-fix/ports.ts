import type { CleanVerifyResult, CleanVerifyStage, DeveloperIdentity, FailingCheck } from "./types.js";
import type { HumanFixStateDb } from "./state-db.js";

/** Local port of Task 055 / Task 060 `CleanVerifierHarness`. */
export interface CleanVerifierHarnessPort {
  run(taskId: string, commitSha: string): Promise<CleanVerifyResult>;
}

/** Local port of Task 038 `WorktreeSlotPool`. */
export interface WorktreeSlotPoolPort {
  resolveTaskWorktree(taskId: string): { readonly path: string; readonly branch: string };
}

/** Local port of Task 171 `ActiveScopeOverlapDetector`. */
export interface ActiveScopeOverlapDetectorPort {
  findCollidingActiveTask(paths: readonly string[], exceptTaskId: string): string | null;
}

/** Local port of Task 111 `ProjectMergeQueue`. */
export interface ProjectMergeQueuePort {
  enqueueHumanFix(taskId: string, commitSha: string, author: DeveloperIdentity): { readonly queued: true; readonly position: number };
}

/** Local port of Task 059 `VerificationHintLadder` plus Task 087 `ReverseImpactWalker`. */
export interface VerificationHintLadderPort {
  repairStaleCheck(checkId: string, rationale: string, commitSha: string): {
    readonly updatedSpecIds: readonly string[];
    readonly rereunOk: boolean;
  };
}

export class InMemoryCleanVerifier implements CleanVerifierHarnessPort {
  constructor(
    private readonly failChecks: ReadonlyMap<string, FailingCheck>,
    private readonly identity: DeveloperIdentity,
  ) {}

  async run(taskId: string, commitSha: string): Promise<CleanVerifyResult> {
    const stages: CleanVerifyStage[] = [
      { id: "typecheck", label: "typecheck", ok: true },
      { id: "lint", label: "lint", ok: true },
      { id: "STATIC_AUDIT", label: "STATIC_AUDIT", ok: true },
      { id: "leaf_tests", label: "leaf tests", ok: true },
    ];
    for (const check of this.failChecks.values()) {
      stages.push({ id: check.id, label: check.title, ok: false, detail: check.output });
    }
    void commitSha;
    const ok = stages.every((stage) => stage.ok);
    return {
      ok,
      stages,
      commitSha,
      author: this.identity,
      trailers: {
        "EF-Author-Mode": "human-fixed",
        "EF-Task": taskId,
      },
    };
  }
}

export class InMemoryWorktreeSlots implements WorktreeSlotPoolPort {
  constructor(private readonly slots: ReadonlyMap<string, { path: string; branch: string }>) {}

  resolveTaskWorktree(taskId: string): { readonly path: string; readonly branch: string } {
    const slot = this.slots.get(taskId);
    if (!slot) {
      return { path: "", branch: `harness/t/${taskId}` };
    }
    return slot;
  }
}

export class InMemoryOverlapDetector implements ActiveScopeOverlapDetectorPort {
  constructor(private readonly graph: HumanFixStateDb) {}

  findCollidingActiveTask(paths: readonly string[], exceptTaskId: string): string | null {
    for (const worker of this.graph.listActiveWorkers()) {
      if (worker.taskId === exceptTaskId) continue;
      for (const path of paths) {
        if (worker.paths.some((owned) => owned === path || path.startsWith(`${owned}/`))) {
          return worker.taskId;
        }
      }
    }
    return null;
  }
}

export class InMemoryMergeQueue implements ProjectMergeQueuePort {
  readonly queue: { taskId: string; commitSha: string; author: DeveloperIdentity }[] = [];

  enqueueHumanFix(taskId: string, commitSha: string, author: DeveloperIdentity): { readonly queued: true; readonly position: number } {
    this.queue.push({ taskId, commitSha, author });
    return { queued: true, position: this.queue.length };
  }
}

export class InMemoryHintLadder implements VerificationHintLadderPort {
  repairStaleCheck(checkId: string, rationale: string, commitSha: string): {
    readonly updatedSpecIds: readonly string[];
    readonly rereunOk: boolean;
  } {
    void rationale;
    void commitSha;
    return { updatedSpecIds: [`spec-for-${checkId}`], rereunOk: true };
  }
}