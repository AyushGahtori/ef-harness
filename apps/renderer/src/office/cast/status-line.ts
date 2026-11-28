import type { OfficeWorkerRecord } from "./types.js";

/**
 * Local stand-in for Task 124 `DeterministicStatusLineFormatter`.
 * The office hover line uses the Task 163 punctuation:
 * `Running vitest · slot 1/2 · 14s`.
 */
export function formatOfficeStatusLine(worker: OfficeWorkerRecord): string {
  const elapsed = `${worker.elapsedSeconds}s`;
  if (worker.health?.kind === "loop_detected" || worker.status === "looping") {
    return `Repeating error 3\u00d7 \u00b7 ${elapsed}`;
  }
  if (worker.health?.kind === "stuck_no_progress") {
    return `No progress \u00b7 ${elapsed}`;
  }
  if (worker.status === "running" || worker.status === "verifying") {
    const command = worker.commandLabel ?? "command";
    const slot = worker.poolSlot
      ? `slot ${worker.poolSlot.index}/${worker.poolSlot.capacity}`
      : "slot";
    return `Running ${command} \u00b7 ${slot} \u00b7 ${elapsed}`;
  }
  if (worker.status === "waiting-run-slot") {
    const place =
      worker.queuePosition === undefined ? "queued" : `#${worker.queuePosition} in queue`;
    return `Waiting for run slot \u00b7 ${place} \u00b7 ${elapsed}`;
  }
  if (worker.status === "thinking") return `Thinking \u00b7 ${elapsed}`;
  if (worker.status === "held") {
    return `Held \u00b7 ${worker.holdReason ?? "paused"} \u00b7 ${elapsed}`;
  }
  if (worker.status === "waiting-on-you") return `Waiting on you \u00b7 ${elapsed}`;
  if (worker.status === "paused" || worker.status === "allowance-waiting") {
    return `Paused \u00b7 waiting for reset \u00b7 ${elapsed}`;
  }
  if (worker.status === "passed" || worker.status === "done") return `Passed \u00b7 ${elapsed}`;
  if (worker.status === "integrating") return `Integrating \u00b7 ${elapsed}`;
  if (worker.status === "queued") return `Queued \u00b7 ${elapsed}`;
  return `${worker.status} \u00b7 ${elapsed}`;
}
