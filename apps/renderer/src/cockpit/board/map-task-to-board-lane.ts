import type { BoardLaneId, BoardTaskRecord } from "./types.js";

const TERMINAL_CLOSED = new Set(["MERGED_TO_FEATURE", "SUPERSEDED", "CANCELLED"]);

/**
 * Map one state.db task to exactly one board lane.
 *
 * Precedence: terminal closure, then active holds, then an open inbox / human
 * wait, then merge or feature wiring, then acceptance, then verification,
 * then an active claim, otherwise queued. Pool wait stays inside Working.
 */
export function mapTaskToBoardLane(task: BoardTaskRecord): BoardLaneId {
  if (TERMINAL_CLOSED.has(task.state)) return "done";
  if (task.holds.length > 0) return "held";
  if (
    task.openInboxItemId !== null ||
    task.state === "WAITING_INPUT" ||
    task.state === "HUMAN_OWNED" ||
    task.state === "EXHAUSTED"
  ) {
    return "waiting_on_you";
  }
  if (
    task.mergeBehindCount !== null ||
    task.activity === "feature_wiring" ||
    task.activity === "project_merge"
  ) {
    return "integrating";
  }
  if (task.state === "ACCEPTED") return "done";
  if (
    task.state === "STATIC_AUDIT" ||
    task.state === "CLEAN_VERIFY" ||
    task.activity === "verifying" ||
    task.reviewer === "reviewer@1"
  ) {
    return "verifying";
  }
  if (
    task.state === "CODING" ||
    task.state === "LEASED" ||
    task.state === "ESCALATED" ||
    (task.state === "PARKED" && (task.holderAttempt !== null || task.poolPhase !== null))
  ) {
    return "working";
  }
  return "queued";
}
