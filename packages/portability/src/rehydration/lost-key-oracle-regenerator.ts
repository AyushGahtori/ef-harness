import type { ExportEntity, IndependentOracleAuthorSealerPort, RehydratedGraph } from "./types.js";
import type { OrphanBranchRehydrationResult } from "./orphan-branch-rehydrator.js";

export interface LostKeyRegenerationCard {
  readonly title: string;
  readonly message: string;
  readonly canEnterRecoveryKey: boolean;
  readonly canRegenerateFromSpecs: boolean;
  readonly estimatedRegenerationCostUsd: number;
}

export class LostKeyOracleRegenerator {
  constructor(private readonly sealer: IndependentOracleAuthorSealerPort) {}

  buildCard(result: OrphanBranchRehydrationResult): LostKeyRegenerationCard | null {
    if (result.undecryptableCheckPaths.length === 0) return null;
    return {
      title: "Sealed checks need a recovery key",
      message:
        "Sealed acceptance checks are encrypted with a key from your other device — Enter recovery key, OR regenerate fresh sealed checks from your specs (~$0.12)",
      canEnterRecoveryKey: true,
      canRegenerateFromSpecs: true,
      estimatedRegenerationCostUsd: 0.12,
    };
  }

  async regenerateFromSpecs(
    graph: RehydratedGraph,
    recipientPublicKey: string,
  ): Promise<Array<{ readonly featureId: string; readonly path: string; readonly ageContent: string }>> {
    const knowledgeEntities = graph.entities.filter((entity) => entity.deleted !== true) as readonly ExportEntity[];
    return this.sealer.regenerateSealedChecksFromSpecs({
      projectId: graph.projectId,
      entities: knowledgeEntities,
      recipientPublicKey,
    });
  }
}