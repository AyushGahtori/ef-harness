import { namedConnectionFromDriver } from "../driver/named-connection.js";
import type { ProjectStateDb } from "../state-db/project-state-db.js";
import type { SafeModeReason } from "../state-db/types.js";
import { CoordinatorWriteQueue, type CoordinatorWriteQueueOptions } from "./coordinator-write-queue.js";
import { defaultComputeRequestHash } from "./request-hash.js";
import type { ProjectStateDb as WriteQueueState } from "./types.js";

/**
 * Bind the savepoint group-commit queue to the open `ProjectStateDb` writer.
 * `submitOperation` is the Promise entrypoint. `submitOperationSync` runs one
 * idempotent operation immediately when the writer is free.
 * The returned queue does not close that handle.
 */
export function bindCoordinatorWriteQueue(
  stateDb: ProjectStateDb,
  options: Omit<CoordinatorWriteQueueOptions, "stateDb"> = {},
): CoordinatorWriteQueue {
  const computeRequestHash = options.computeRequestHash ?? defaultComputeRequestHash;
  return new CoordinatorWriteQueue({
    ...options,
    stateDb: adaptStateDb(stateDb),
    computeRequestHash,
  });
}

function adaptStateDb(stateDb: ProjectStateDb): WriteQueueState {
  return {
    isSafeMode(): boolean {
      return stateDb.isSafeMode();
    },
    enterSafeMode(reason, diagnostics): void {
      const mapped: SafeModeReason = reason === "corrupt" ? "corrupt" : "disk_io_error";
      const codeText = typeof diagnostics?.sqliteCode === "string" ? diagnostics.sqliteCode : reason;
      const count = diagnostics?.operationCount;
      const message = typeof count === "number" ? `${codeText} operations=${count}` : codeText;
      stateDb.enterSafeMode(mapped, {
        message,
        worktreesPreserved: true,
        checkpointsPreserved: true,
      });
    },
    writer: namedConnectionFromDriver(stateDb.writer),
  };
}
