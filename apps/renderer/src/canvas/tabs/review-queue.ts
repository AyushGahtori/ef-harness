import type { CanonicalStateDb } from "./state-db.js";
import type { ProposedRequirementReviewQueuePort } from "./ports.js";
import type { EarsOracleValidatorPort } from "./ports.js";
import type { ReviewGroup, ReviewSettleCommand, ReviewSettleResult } from "./types.js";
import { LocalEarsOracleValidator, ReviewValidationError } from "./validator.js";

function unique(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

export class LocalProposedRequirementReviewQueue implements ProposedRequirementReviewQueuePort {
  constructor(
    private readonly db: CanonicalStateDb,
    private readonly validator: EarsOracleValidatorPort = new LocalEarsOracleValidator(),
  ) {}

  groups(): readonly ReviewGroup[] {
    const grouped = new Map<string, ReviewGroup>();
    for (const proposal of this.db.listProposals()) {
      const key = `${proposal.featureId}\u0000${proposal.matrixId}`;
      const existing = grouped.get(key);
      if (existing) {
        grouped.set(key, { ...existing, proposals: [...existing.proposals, proposal] });
      } else {
        grouped.set(key, {
          featureId: proposal.featureId,
          featureTitle: proposal.featureTitle,
          matrixId: proposal.matrixId,
          proposals: [proposal],
        });
      }
    }
    return [...grouped.values()];
  }

  approveAll(featureId: string, matrixId?: string): ReviewSettleResult {
    const ids = this.groups().flatMap((group) =>
      group.featureId === featureId && (matrixId === undefined || group.matrixId === matrixId)
        ? group.proposals.map((proposal) => proposal.cellId)
        : [],
    );
    return this.settle({ approve: ids });
  }

  settle(command: ReviewSettleCommand): ReviewSettleResult {
    const approve = unique(command.approve ?? []);
    const reject = unique(command.reject ?? []);
    const edits = command.edits ?? [];
    const editIds = edits.map((edit) => edit.cellId);
    const seen = new Set<string>();
    for (const id of [...approve, ...reject, ...editIds]) {
      if (seen.has(id)) {
        throw new ReviewValidationError(id, ["a cell cannot be approved, edited, and rejected in one settle"]);
      }
      seen.add(id);
    }
    const pending = new Set(this.db.listProposals().map((proposal) => proposal.cellId));
    for (const id of seen) {
      if (!pending.has(id)) {
        throw new ReviewValidationError(id, ["cell is not a pending medium-risk proposal"]);
      }
    }
    for (const edit of edits) {
      const verdict = this.validator.validate({ earsText: edit.earsText, oracleSketch: edit.oracleSketch });
      if (!verdict.ok) throw new ReviewValidationError(edit.cellId, verdict.problems);
    }
    return this.db.applyReview({ approve, reject, edits });
  }
}
