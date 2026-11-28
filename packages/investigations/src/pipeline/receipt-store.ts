import type { InvestigationReceipt, ProvenRootCause, ReproScript, SymptomCard } from "./types.js";
import type { SqliteInvestigationStore } from "./investigation-store.js";

export class InvestigationReceiptStore {
  constructor(private readonly store: SqliteInvestigationStore) {}

  build(
    investigationId: string,
    card: SymptomCard,
    repro: ReproScript,
    rootCause: ProvenRootCause,
    flipSummary: string,
    fixDiff: string,
    permanentTests: readonly string[],
    falsified: readonly string[],
  ): InvestigationReceipt {
    return {
      investigationId,
      symptomSummary: `${card.title}: ${card.observedBehavior}`,
      reproCommand: repro.command.join(" "),
      falsifiedHypotheses: falsified,
      provenRootCause: rootCause,
      minimalFlipProof: flipSummary,
      surgicalFixDiff: fixDiff,
      permanentTestsAdded: permanentTests,
      gitTrailers: [
        `EF-Investigation: ${investigationId}`,
        "EF-Root-Cause-Verified: true",
      ],
    };
  }

  persist(investigationId: string, receipt: InvestigationReceipt): InvestigationReceipt {
    this.store.saveReceipt(investigationId, receipt);
    return receipt;
  }
}