import { EDITOR_OVERLAP_HOLD_REASON, OVERLAP_CHOICES } from "./constants.js";
import { pathMatchesWriteScope } from "./scope-match.js";
import type {
  ActiveTasksPort,
  CoexistenceEventStorePort,
  CoexistenceUiPort,
  HumanOwnedTransitionPort,
  HoldPlacement,
  LandingOverlapFlagPort,
  TaskHoldsManagerPort,
} from "./ports.js";
import type { OverlapChoice } from "./constants.js";
import { OverlapSuppressionCache } from "./overlap-suppression.js";

export interface OverlapDetection {
  readonly filePath: string;
  readonly taskId: string;
  readonly agentLabel: string;
  readonly hold: HoldPlacement | null;
}

export interface ActiveScopeOverlapDetectorOptions {
  readonly tasks: ActiveTasksPort;
  readonly holds: TaskHoldsManagerPort;
  readonly ui: CoexistenceUiPort;
  readonly events: CoexistenceEventStorePort;
  readonly humanOwned: HumanOwnedTransitionPort;
  readonly landingFlags: LandingOverlapFlagPort;
  readonly suppression?: OverlapSuppressionCache;
}

/**
 * Cross-check developer-edited paths against active worker `write_scope[]` and
 * emit a surgical `editor_overlap` hold plus the 3-choice overlap card.
 */
export class ActiveScopeOverlapDetector {
  private readonly suppression: OverlapSuppressionCache;
  private readonly activeHolds = new Map<string, HoldPlacement>();

  constructor(private readonly options: ActiveScopeOverlapDetectorOptions) {
    this.suppression = options.suppression ?? new OverlapSuppressionCache();
  }

  detectOverlaps(filePath: string): readonly OverlapDetection[] {
    const hits: OverlapDetection[] = [];
    for (const task of this.options.tasks.listActive()) {
      if (!pathMatchesWriteScope(filePath, task.writeScope)) continue;
      if (this.suppression.isSuppressed(filePath, task.taskId)) {
        hits.push({ filePath, taskId: task.taskId, agentLabel: task.agentLabel, hold: null });
        continue;
      }
      const hold = this.options.holds.placeHold(
        task.taskId,
        EDITOR_OVERLAP_HOLD_REASON,
        `Developer edited ${filePath}`,
      );
      const holdKey = `${filePath}\0${task.taskId}`;
      this.activeHolds.set(holdKey, hold);
      this.options.ui.showOverlapCard({
        filePath,
        taskId: task.taskId,
        agentLabel: task.agentLabel,
        choices: OVERLAP_CHOICES,
      });
      hits.push({ filePath, taskId: task.taskId, agentLabel: task.agentLabel, hold });
    }
    return hits;
  }

  resolveOverlap(filePath: string, taskId: string, choice: OverlapChoice): void {
    const holdKey = `${filePath}\0${taskId}`;
    const hold = this.activeHolds.get(holdKey);
    if (hold) {
      this.options.holds.releaseHold(hold.holdId);
      this.activeHolds.delete(holdKey);
    }
    this.suppression.remember(filePath, taskId, choice);
    this.options.events.append({
      kind: "overlap_decision",
      payload: { filePath, taskId, choice },
    });
    if (choice === "take_over") {
      this.options.humanOwned.transitionToHumanOwned(taskId, filePath);
    } else if (choice === "keep_both") {
      this.options.landingFlags.flagKeepBoth(filePath, taskId);
    }
  }

  suppressionCache(): OverlapSuppressionCache {
    return this.suppression;
  }
}