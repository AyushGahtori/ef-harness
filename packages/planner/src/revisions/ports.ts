import type { ContradictionFinding, RevisionEdit } from "./types.js";

/**
 * Local stand-in for Task 021 `TaskHoldAndSubmissionRepo.placeHold`.
 * `revision_in_flight` is not in that task's `HOLD_REASONS` yet.
 */
export interface TaskHoldsPort {
  placeHold(input: {
    readonly taskId: string;
    readonly reason: "revision_in_flight";
    readonly source: string;
    readonly createdAt: number;
  }): void;
}

/**
 * Local stand-in for Task 081 `FiveLayerContradictionEngine`.
 * One call covers the whole coalesced batch.
 */
export interface FiveLayerContradictionPort {
  checkCombinedState(input: {
    readonly edits: readonly RevisionEdit[];
  }): { readonly contradictions: readonly ContradictionFinding[] };
}

/**
 * Local stand-in for Task 071 `PremiseSupersessionReopener.reopenDependents`.
 */
export interface PremiseSupersessionPort {
  reopenDependents(
    premiseId: string,
    reason: "revised",
  ): { readonly reopenedIds: readonly string[] };
}

/**
 * Local stand-in for Task 017 `KnowledgeGraphRepo.impactWalk`.
 * The walker executes schema/queries.sql `impact_walk` directly until that repo is wired.
 */
export interface KnowledgeGraphImpactPort {
  impactWalk(startId: string, maxDepth?: number): readonly { readonly id: string; readonly depth: number }[];
}

export class AcceptingContradictionEngine implements FiveLayerContradictionPort {
  calls = 0;

  checkCombinedState(): { readonly contradictions: readonly ContradictionFinding[] } {
    this.calls += 1;
    return { contradictions: [] };
  }
}

export class ScriptedContradictionEngine implements FiveLayerContradictionPort {
  calls = 0;

  constructor(
    private readonly detect: (edits: readonly RevisionEdit[]) => readonly ContradictionFinding[],
  ) {}

  checkCombinedState(input: {
    readonly edits: readonly RevisionEdit[];
  }): { readonly contradictions: readonly ContradictionFinding[] } {
    this.calls += 1;
    return { contradictions: this.detect(input.edits) };
  }
}

export class LocalPremiseSupersessionReopener implements PremiseSupersessionPort {
  readonly calls: { readonly premiseId: string; readonly reason: "revised" }[] = [];

  reopenDependents(
    premiseId: string,
    reason: "revised",
  ): { readonly reopenedIds: readonly string[] } {
    this.calls.push({ premiseId, reason });
    return { reopenedIds: [] };
  }
}
