import type { KnowledgeGraphPort } from "./state-db.js";

/**
 * Local port of Task 114 immediate stop for workers still on `harness/f/F`.
 * Records the halt in the undo runtime store. It does not signal arbitrary PIDs.
 */
export class ActiveTaskHaltPort {
  constructor(private readonly graph: KnowledgeGraphPort) {}

  haltFeature(featureId: string): string[] {
    return this.graph.haltWorkers(featureId);
  }
}

/**
 * Local port of Task 116. Retires Inbox questions that belong only to the undone feature.
 */
export class InboxRetirementPort {
  constructor(private readonly graph: KnowledgeGraphPort) {}

  retireExclusive(featureId: string): string[] {
    return this.graph.retireExclusiveInbox(featureId);
  }
}
