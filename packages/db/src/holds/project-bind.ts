import { loadCanonicalSqlAsset } from "../driver/query-catalog.js";
import { namedConnectionFromDriver } from "../driver/named-connection.js";
import type { ProjectStateDb } from "../state-db/project-state-db.js";
import { createTaskHoldAndSubmissionRepo } from "./repo.js";
import type { TaskHoldAndSubmissionRepo } from "./repo.js";

/**
 * Bind holds and fenced submissions to the open `ProjectStateDb` writer.
 * The returned repo does not close that handle.
 */
export function bindTaskHolds(stateDb: ProjectStateDb): TaskHoldAndSubmissionRepo {
  return createTaskHoldAndSubmissionRepo(
    namedConnectionFromDriver(stateDb.writer),
    loadCanonicalSqlAsset("queriesSql"),
  );
}
