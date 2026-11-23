import type { SweepAuditScorecard } from "./types.js";

export type ChecklistGlobRewrite = {
  readonly taskId: string;
  readonly globs: string[];
};

export type ResyncRefreshResult = {
  readonly codeIndexRefreshed: boolean;
  readonly nameRegistryRefreshed: boolean;
  readonly stateDbRefreshed: boolean;
  readonly checklistRewrites: readonly ChecklistGlobRewrite[];
};

export class PostSweepResyncPlanner {
  recomputeChecklistGlobs(
    rewrites: Readonly<Record<string, string>>,
    tasks: readonly { taskId: string; writeScope: readonly string[] }[],
  ): ChecklistGlobRewrite[] {
    return tasks.map((task) => ({
      taskId: task.taskId,
      globs: task.writeScope.map((glob) => {
        for (const [oldPath, newPath] of Object.entries(rewrites)) {
          if (glob === oldPath || glob.startsWith(`${oldPath}/`)) {
            return glob.replace(oldPath, newPath);
          }
        }
        return glob;
      }),
    }));
  }

  planFullResync(rewrites: Readonly<Record<string, string>>): ResyncRefreshResult {
    return {
      codeIndexRefreshed: Object.keys(rewrites).length >= 0,
      nameRegistryRefreshed: true,
      stateDbRefreshed: true,
      checklistRewrites: [],
    };
  }
}

export class SweepAuditScorecardRecorder {
  private readonly runs = new Map<string, SweepAuditScorecard>();

  record(scorecard: SweepAuditScorecard): void {
    this.runs.set(scorecard.sweepId, scorecard);
  }

  get(sweepId: string): SweepAuditScorecard | undefined {
    return this.runs.get(sweepId);
  }
}