import { namedConnectionFromDriver } from "../driver/named-connection.js";
import type { ProjectStateDb } from "../state-db/project-state-db.js";
import { TaskLeaseManager } from "./task-lease-manager.js";

/**
 * Bind task claiming and sweep path leases to the open `ProjectStateDb` writer.
 * The returned manager does not close that handle.
 */
export function bindTaskLeases(stateDb: ProjectStateDb): TaskLeaseManager {
  return new TaskLeaseManager({ db: namedConnectionFromDriver(stateDb.writer) });
}
