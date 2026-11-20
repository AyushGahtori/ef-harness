import type { DecisionStore } from "./decision-store.js";
import { stripSettlement } from "./decision-fields.js";
import type { KnowledgeGraphRepo } from "./knowledge-graph.js";

/**
 * Local port of Task 071 `PremiseSupersessionReopener`.
 * Reopens `derived` dependents of a superseded premise and leaves `explicit`
 * dependents untouched. Swap for the Task 071 export when that branch is integrated.
 */
export interface PremiseSupersessionReopener {
  reopenDependents(premiseDecisionId: string): readonly string[];
}

export class LocalPremiseSupersessionReopener implements PremiseSupersessionReopener {
  constructor(
    private readonly graph: KnowledgeGraphRepo,
    private readonly store: DecisionStore,
  ) {}

  reopenDependents(premiseDecisionId: string): readonly string[] {
    const edges = this.graph.listCurrentEdges("derived_from", premiseDecisionId);
    const reopened: string[] = [];
    for (const edge of edges) {
      const node = this.graph.getNode(edge.src);
      if (!node || node.kind !== "decision") continue;
      const decision = this.store.list().find((item) => item.nodeId === node.id);
      if (!decision) continue;
      if (decision.basis === "explicit") continue;
      if (decision.basis !== "derived" && decision.status !== "settled") continue;
      const opened = stripSettlement(decision);
      this.store.save(opened);
      reopened.push(decision.criterionId);
    }
    return reopened;
  }
}
