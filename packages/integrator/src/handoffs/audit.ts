import { HandoffDatabase } from "./database.js";
import { HandoffNotFoundError } from "./errors.js";
import type { HandoffArtifact, HandoffLineage } from "./types.js";

export class HandoffAuditTrail {
  constructor(private readonly db: HandoffDatabase) {}

  lineage(handoffId: string): HandoffLineage {
    const chain: HandoffArtifact[] = [];
    const seen = new Set<string>();
    let cursor: string | null = handoffId;
    while (cursor !== null) {
      if (seen.has(cursor)) break;
      seen.add(cursor);
      const artifact = this.db.getArtifact(cursor);
      if (!artifact) throw new HandoffNotFoundError(cursor);
      chain.push(artifact);
      cursor = artifact.priorHandoffId;
    }
    chain.reverse();
    const first = chain[0];
    if (!first) throw new HandoffNotFoundError(handoffId);
    return {
      artifacts: chain,
      roles: [first.fromRole, ...chain.map((item) => item.toRole)],
    };
  }

  forTask(taskId: string): readonly HandoffArtifact[] {
    return this.db.listArtifacts().filter((artifact) => artifact.fromTaskId === taskId || artifact.toTaskId === taskId);
  }
}
