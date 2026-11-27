import type { ProjectStateDb } from "../state-db/project-state-db.js";
import { EffectsRepo } from "./repo.js";

/**
 * Bind the effect ledger to the open `ProjectStateDb` writer.
 * The returned repo does not close that handle and does not open a second database.
 */
export function bindEffects(stateDb: ProjectStateDb): EffectsRepo {
  return new EffectsRepo(stateDb.writer);
}
