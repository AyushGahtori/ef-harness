import {
  JUNIOR_MAX_STEPS,
  NO_PROGRESS_STEP_LIMIT,
  REPEAT_TOOL_LIMIT,
  SENIOR_MAX_STEPS,
  type TurnLogRow,
  type WorkerLevel,
} from "./types.js";
import { repeatSignature } from "./normalize.js";

export function maxStepsFor(level: WorkerLevel, override: number | null): number {
  if (override !== null) {
    if (!Number.isSafeInteger(override) || override < 1) {
      throw new Error("maxSteps override must be a positive integer");
    }
    return override;
  }
  return level === "senior" ? SENIOR_MAX_STEPS : JUNIOR_MAX_STEPS;
}

export function countPrefixed(turns: readonly TurnLogRow[], prefix: string): number {
  return turns.reduce((count, turn) => {
    return turn.resultSummary?.startsWith(prefix) ? count + 1 : count;
  }, 0);
}

export function repeatCount(turns: readonly TurnLogRow[], toolCall: string, summary: string): number {
  const signature = repeatSignature(toolCall, summary);
  return turns.reduce((count, turn) => {
    if (!turn.toolCall || !turn.resultSummary) return count;
    if (turn.resultSummary.startsWith("malformed:")) return count;
    if (turn.resultSummary.startsWith("steer_ack_required:")) return count;
    if (turn.resultSummary.startsWith("prose_")) return count;
    if (turn.resultSummary.startsWith("done_")) return count;
    return repeatSignature(turn.toolCall, turn.resultSummary) === signature ? count + 1 : count;
  }, 0);
}

export function repeatWouldStick(turns: readonly TurnLogRow[], toolCall: string, summary: string): boolean {
  return repeatCount(turns, toolCall, summary) + 1 >= REPEAT_TOOL_LIMIT;
}

export interface ProgressCursor {
  streak: number;
  tree: string | null;
  fingerprint: string | null;
}

export function nextProgress(
  cursor: ProgressCursor,
  tree: string,
  fingerprint: string | null,
): ProgressCursor & { stuck: boolean } {
  if (fingerprint === null) {
    return { streak: 0, tree, fingerprint: null, stuck: false };
  }
  if (cursor.tree === tree && cursor.fingerprint === fingerprint) {
    const streak = cursor.streak + 1;
    return { streak, tree, fingerprint, stuck: streak >= NO_PROGRESS_STEP_LIMIT };
  }
  return { streak: 1, tree, fingerprint, stuck: false };
}
