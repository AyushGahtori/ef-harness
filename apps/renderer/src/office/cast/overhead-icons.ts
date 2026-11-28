import type { OfficeWorkerRecord, OverheadIconId } from "./types.js";

/**
 * 16-px overhead icon for the current state.db row.
 * Chosen on the projection frame. No walk queue can delay it.
 */
export function overheadIconFor(worker: OfficeWorkerRecord): OverheadIconId | null {
  const health = worker.health?.kind;
  if (health === "loop_detected" || worker.status === "looping") return "spinning-loop";
  if (health === "stuck_no_progress") return "amber-clock";
  if (worker.status === "waiting-on-you" || health === "waiting_on_you") return "raised-hand";
  if (worker.status === "held") return "pause-bars";
  if (
    worker.status === "paused" ||
    worker.status === "allowance-waiting" ||
    health === "allowance_window_wait" ||
    health === "rate_limited_backoff"
  ) {
    return "coffee-cup";
  }
  if (worker.status === "waiting-run-slot") return "hourglass";
  if (worker.status === "passed" || worker.status === "done") return "green-check";
  if (worker.status === "thinking") return "typing-dots";
  return null;
}
