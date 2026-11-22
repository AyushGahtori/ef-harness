import {
  HARD_HOLD,
  NEARLY_FINISHED_PROGRESS,
  SOFT_HOLD,
  VERIFYING_STATES,
  type ClassificationInput,
  type HoldModeDecision,
} from "./types.js";

/**
 * Least-wasteful safe mode for one affected task.
 *
 * Hard hold: the pending change is contradictory, or the task is still early,
 * so the worker pauses at the current step boundary.
 * Soft hold + quarantine: the task is at least 80% done or already verifying,
 * and the change is not contradictory. The in-flight step may finish into
 * `submission_pending`. A false-alarm reading then lands without another
 * worker turn. The F-Orders (20%) / F-Reports (verifying at 95%) case follows
 * this split: early affected work is hard, nearly finished work is soft.
 */
export class HoldModeClassifier {
  classify(input: ClassificationInput): HoldModeDecision {
    if (!input.impacted) return { action: "continue" };
    if (input.destructive) return { action: HARD_HOLD, quarantine: false };
    if (input.progress >= NEARLY_FINISHED_PROGRESS || isVerifying(input.state)) {
      return { action: SOFT_HOLD, quarantine: true };
    }
    return { action: HARD_HOLD, quarantine: false };
  }
}

function isVerifying(state: string): boolean {
  return (VERIFYING_STATES as readonly string[]).includes(state);
}
