import { planCriterion } from "./ask-value-guard.js";
import { automaticFields } from "./decision-fields.js";
import type { DecisionStore } from "./decision-store.js";
import type { GreedyQuestionSelector } from "./greedy-selector.js";
import type { MustAskPolicyFloor } from "./must-ask-floor.js";
import type { CatalogIndex } from "./catalog.js";
import type { AcceptAllResult, DepthClock, DepthDecision, GreedyQuestionCandidate, MustAskClass } from "./types.js";

/**
 * One click delegates every non-must-ask question in the current batch, or every
 * open non-must-ask criterion in the scope. Must-ask questions stay visible with a badge.
 * The written basis is always `delegated`.
 */
export class AcceptAllRecommendedAction {
  constructor(
    private readonly store: DecisionStore,
    private readonly floor: MustAskPolicyFloor,
    private readonly catalog: CatalogIndex,
    private readonly selector: GreedyQuestionSelector,
    private readonly clock: DepthClock,
  ) {}

  accept(input?: {
    readonly scope?: "batch" | "open";
    readonly criterionIds?: readonly string[];
    readonly k?: number;
  }): AcceptAllResult {
    const stage = this.store.persistedStage();
    return this.store.run("chat", "accept all recommended", () => {
      const ids = this.targets(input);
      const delegatedCriterionIds: string[] = [];
      const held: { criterionId: string; badge: string }[] = [];
      const skippedSettled: string[] = [];
      for (const criterionId of ids) {
        const current = this.store.require(criterionId);
        if (current.basis !== undefined) {
          skippedSettled.push(criterionId);
          continue;
        }
        const entry = this.catalog.get(criterionId);
        const plan = planCriterion(entry, current, stage, this.floor);
        if (plan.blockReason !== null || plan.recommendation.kind !== "option") {
          const badge = plan.badge ?? "Needs your decision (no safe recommendation for this stage)";
          this.store.save(heldOpen(current, plan.mustAsk, plan.mustAskClass, badge, plan));
          held.push({ criterionId, badge });
          continue;
        }
        this.store.save(
          automaticFields({
            current,
            basis: "delegated",
            optionId: plan.recommendation.optionId,
            rationale: plan.recommendation.rationale,
            stage,
            at: this.clock.now(),
            askValue: plan.score.askValue,
            impact: plan.score.impact,
            uncertainty: plan.score.uncertainty,
          }),
        );
        delegatedCriterionIds.push(criterionId);
      }
      return { delegatedCriterionIds, held, skippedSettled };
    });
  }

  private targets(input?: {
    readonly scope?: "batch" | "open";
    readonly criterionIds?: readonly string[];
    readonly k?: number;
  }): readonly string[] {
    if (input?.scope === "open") {
      return this.store
        .list()
        .filter((decision) => decision.basis === undefined)
        .map((decision) => decision.criterionId)
        .sort((left, right) => left.localeCompare(right));
    }
    if (input?.criterionIds) return [...input.criterionIds];
    const open = this.store.list().filter((decision) => decision.basis === undefined);
    const candidates = open.map((decision, index) => toCandidate(decision, index));
    const batch = this.selector.selectBatch(candidates, input?.k ?? 3);
    if (batch.length > 0) return batch.flatMap((question) => [...question.criterionIds]);
    return open.map((decision) => decision.criterionId);
  }
}

function toCandidate(decision: DepthDecision, index: number): GreedyQuestionCandidate {
  return {
    id: decision.criterionId,
    criterionIds: [decision.criterionId],
    mustAsk: decision.mustAsk,
    conflict: decision.conflict === true || decision.status === "conflict",
    downstreamUnblocks: decision.downstreamTaskCount,
    catalogPriority: index,
  };
}

function heldOpen(
  current: DepthDecision,
  mustAsk: boolean,
  mustAskClass: MustAskClass | null,
  badge: string,
  plan: { readonly score: { readonly askValue: number; readonly impact: number; readonly uncertainty: number } },
): DepthDecision {
  const next: DepthDecision = {
    nodeId: current.nodeId,
    version: current.version,
    criterionId: current.criterionId,
    label: current.label,
    status: current.status === "conflict" ? "conflict" : "open",
    value: null,
    workItemId: current.workItemId,
    impactLevel: current.impactLevel,
    downstreamTaskCount: current.downstreamTaskCount,
    mustAsk,
    decisionBadge: badge,
    askValue: plan.score.askValue,
    impact: plan.score.impact,
    uncertainty: plan.score.uncertainty,
  };
  let stamped = next;
  if (mustAskClass) stamped = { ...stamped, mustAskClass };
  if (current.domain !== undefined) stamped = { ...stamped, domain: current.domain };
  if (current.conflict === true) stamped = { ...stamped, conflict: true };
  if (current.highRiskSpecExpander === true) stamped = { ...stamped, highRiskSpecExpander: true };
  if (current.ambiguousBrownfield === true) stamped = { ...stamped, ambiguousBrownfield: true };
  return stamped;
}
