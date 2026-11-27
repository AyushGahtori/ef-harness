import type { ProjectStateDb } from "../state-db/project-state-db.js";
import { registryDatabaseFromDriver } from "./database.js";
import { NameRegistryService } from "./name-registry-service.js";

/** Name checks use the same `ProjectStateDb` writer as the knowledge graph. */
export function bindNameRegistry(stateDb: ProjectStateDb): NameRegistryService {
  return new NameRegistryService(registryDatabaseFromDriver(stateDb.writer));
}
