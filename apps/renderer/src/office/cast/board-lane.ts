import type { BoardLane, WorkerStatus } from "./types.js";

/**
 * Local stand-in for Task 124 `mapTaskToBoardLane`.
 * Waiting for a Pool 2 slot stays on the Working lane, matching the Board's
 * Thinking / run-slot / running split.
 */
export function mapStatusToBoardLane(status: WorkerStatus): BoardLane {
  switch (status) {
    case "queued":
      return "Queued";
    case "thinking":
    case "waiting-run-slot":
    case "running":
      return "Working";
    case "waiting-on-you":
      return "Waiting on You";
    case "held":
    case "paused":
    case "idle":
    case "parked":
    case "allowance-waiting":
      return "Held";
    case "verifying":
    case "looping":
      return "Verifying";
    case "integrating":
      return "Integrating";
    case "passed":
    case "done":
      return "Done";
    default: {
      const unexpected: never = status;
      throw new Error(`Unhandled worker status ${String(unexpected)}`);
    }
  }
}
