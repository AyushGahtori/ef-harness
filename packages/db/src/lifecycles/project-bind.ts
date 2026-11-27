import { loadCanonicalSqlAsset } from "../driver/query-catalog.js";
import { namedConnectionFromDriver } from "../driver/named-connection.js";
import type { ProjectStateDb } from "../state-db/project-state-db.js";
import { loadCanonicalQueries } from "./queries.js";
import { createLifecycleRepo } from "./repo.js";
import type { LifecycleRepo } from "./repo.js";

/**
 * Bind feature and project lifecycles to the open `ProjectStateDb` writer.
 * The returned repo does not close that handle.
 */
export function bindLifecycles(stateDb: ProjectStateDb): LifecycleRepo {
  return createLifecycleRepo(
    namedConnectionFromDriver(stateDb.writer),
    loadCanonicalQueries(loadCanonicalSqlAsset("queriesSql")),
  );
}
