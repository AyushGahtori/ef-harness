import type { DaemonStoreSnapshot, ThreePoolCapacitySnapshot } from "./types.js";
import { boardTaskFromStateDb, type StateDbBoardRow } from "./state-db-adapter.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCapacity(value: unknown): value is ThreePoolCapacitySnapshot {
  if (!isRecord(value)) return false;
  return (
    typeof value.thinkingUsed === "number" &&
    typeof value.thinkingCapacity === "number" &&
    typeof value.runSlotsUsed === "number" &&
    typeof value.runSlotsCapacity === "number" &&
    typeof value.verifierRunSlots === "number" &&
    typeof value.workerRunSlots === "number" &&
    typeof value.runSlotQueueDepth === "number" &&
    typeof value.mergeQueueIdle === "boolean" &&
    typeof value.mergeQueueDetail === "string"
  );
}

function isStateRow(value: unknown): value is StateDbBoardRow {
  if (!isRecord(value)) return false;
  return (
    typeof value.task === "string" &&
    typeof value.feature === "string" &&
    typeof value.state === "string" &&
    typeof value.level === "string" &&
    typeof value.title === "string" &&
    Array.isArray(value.holds) &&
    Array.isArray(value.blocked_by) &&
    Array.isArray(value.inbox_blocked_tasks)
  );
}

/**
 * Accept either a daemon `StateDbBoardRow` projection or an already mapped board snapshot.
 * Returns null when the payload is not a board document.
 */
export function boardSnapshotFromPayload(payload: unknown): DaemonStoreSnapshot | null {
  if (!isRecord(payload) || typeof payload.revision !== "number" || !isCapacity(payload.capacity)) return null;
  if (!Array.isArray(payload.tasks)) return null;
  if (payload.tasks.every(isStateRow)) {
    return {
      revision: payload.revision,
      tasks: payload.tasks.map((row) => boardTaskFromStateDb(row)),
      capacity: payload.capacity,
    };
  }
  return null;
}
