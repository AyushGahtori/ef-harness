import type { ProjectStateDb } from "../state-db/project-state-db.js";
import { searchConnectionFromDriver } from "./connection.js";
import { KnowledgeSearchService } from "./service.js";

/**
 * Search reads and index maintenance share the `ProjectStateDb` writer so a
 * graph commit and the following `kb_words` query see one connection.
 */
export function bindKnowledgeSearch(stateDb: ProjectStateDb): KnowledgeSearchService {
  const connection = searchConnectionFromDriver(stateDb.writer);
  return new KnowledgeSearchService({ reader: connection, writer: connection });
}
